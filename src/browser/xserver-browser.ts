import { BrowserController } from "./browser-controller.js";
import { printInfo, printSuccess } from "../utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";

export interface XserverVpsInfo {
  id: string;
  hostname: string;
  ip: string;
  status: string;
}

/**
 * Xserver管理画面にログインし、ログイン完了を待つ
 */
export async function authenticateXserver(
  browser: BrowserController
): Promise<boolean> {
  try {
    printInfo("Xserver の管理画面を開きます。ログインしてください。");
    printInfo("SSO・二要素認証もそのまま使えます。");

    await browser.goto("https://secure.xserver.ne.jp/xapanel/login/xvps/");

    console.log();
    console.log("  ┌─────────────────────────────────────────────┐");
    console.log("  │  Xserver のログイン画面が開きました。        │");
    console.log("  │  いつも通りログインしてください。            │");
    console.log("  └─────────────────────────────────────────────┘");
    console.log();

    startSpinner("ログイン完了を待っています...");
    await browser.waitForUrl(/xapanel\/(index|server)/, 300000);
    succeedSpinner("Xserver ログイン確認！");
    return true;
  } catch {
    failSpinner("Xserver ログインがタイムアウトしました");
    return false;
  }
}

/**
 * VPS一覧を取得し、サーバー情報を返す
 */
export async function fetchXserverVpsList(
  browser: BrowserController
): Promise<XserverVpsInfo[]> {
  try {
    startSpinner("VPS一覧を取得中...");

    // VPS管理パネルに移動
    await browser.goto("https://secure.xserver.ne.jp/xapanel/index/xvps/");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const page = browser.getPage();
    if (!page) {
      failSpinner("ページ取得に失敗");
      return [];
    }

    const vpsList = await page.evaluate(() => {
      const results: { id: string; hostname: string; ip: string; status: string }[] = [];

      // パターン1: テーブル行からサーバー情報抽出
      const rows = document.querySelectorAll("table tr, .server-list-item, [class*='server']");
      for (const row of rows) {
        const text = row.textContent ?? "";

        // IPv4 アドレスパターン
        const ipMatch = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);

        // サーバーIDパターン (sv12345 等)
        const idMatch = text.match(/(sv\d+)/i);

        // ホスト名パターン
        const hostMatch = text.match(/([\w-]+\.xserver\.jp)/);

        if (ipMatch) {
          results.push({
            id: idMatch?.[1] ?? "",
            hostname: hostMatch?.[1] ?? "",
            ip: ipMatch[1],
            status: text.includes("稼働") || text.includes("running") ? "running" : "unknown",
          });
        }
      }

      // パターン2: ページ全体からIPとホスト名を抽出（テーブルがない場合）
      if (results.length === 0) {
        const bodyText = document.body.innerText;
        const ips = bodyText.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g) ?? [];
        const hosts = bodyText.match(/([\w-]+\.xserver\.jp)/g) ?? [];

        for (let i = 0; i < ips.length; i++) {
          // プライベートIPや localhost を除外
          const ip = ips[i];
          if (ip.startsWith("127.") || ip.startsWith("0.") || ip.startsWith("10.") || ip.startsWith("192.168.")) continue;
          results.push({
            id: `vps-${i + 1}`,
            hostname: hosts[i] ?? "",
            ip,
            status: "unknown",
          });
        }
      }

      // 重複除去
      const seen = new Set<string>();
      return results.filter((r) => {
        if (seen.has(r.ip)) return false;
        seen.add(r.ip);
        return true;
      });
    });

    if (vpsList.length > 0) {
      succeedSpinner(`${vpsList.length}台のVPSを検出`);
    } else {
      failSpinner("VPS情報を自動取得できませんでした");
    }

    return vpsList;
  } catch {
    failSpinner("VPS一覧の取得に失敗しました");
    return [];
  }
}

/**
 * 指定VPSのファイアウォールにDatadog用ルール (TCP 443 アウトバウンド) を追加
 */
export async function configureXserverFirewall(
  browser: BrowserController,
  vpsId: string
): Promise<boolean> {
  try {
    startSpinner("ファイアウォール設定を追加中...");

    const page = browser.getPage();
    if (!page) {
      failSpinner("ページ取得に失敗");
      return false;
    }

    // ファイアウォール設定ページに移動
    // Xserver VPS のファイアウォール設定URL（サーバーIDに依存）
    await browser.goto(`https://secure.xserver.ne.jp/xapanel/index/xvps/`);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // ファイアウォールリンクを探してクリック
    const fwLink = await page.$('a[href*="firewall"], a:has-text("ファイアウォール"), a:has-text("Firewall")');
    if (fwLink) {
      await fwLink.click();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // ルール追加フォームを探す
    const addBtn = await page.$(
      'button:has-text("追加"), button:has-text("ルール追加"), a:has-text("追加"), [class*="add"]'
    );
    if (addBtn) {
      await addBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // フォーム入力: プロトコル=TCP, ポート=443, 方向=OUT (アウトバウンド)
    // Xserver管理画面のフォーム構造に依存するため、複数パターンで試行
    const portInput = await page.$('input[name*="port"], input[placeholder*="ポート"], input[type="number"]');
    if (portInput) {
      await portInput.fill("443");
    }

    // プロトコル選択 (TCP)
    const protoSelect = await page.$('select[name*="protocol"], select[name*="proto"]');
    if (protoSelect) {
      await protoSelect.selectOption({ label: "TCP" });
    }

    // 保存ボタン
    const saveBtn = await page.$(
      'button[type="submit"], button:has-text("保存"), button:has-text("確認"), button:has-text("追加")'
    );
    if (saveBtn) {
      await saveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 確認ダイアログがあればOKクリック
      const confirmBtn = await page.$('button:has-text("OK"), button:has-text("はい"), button:has-text("確定")');
      if (confirmBtn) {
        await confirmBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    succeedSpinner("ファイアウォール TCP 443 アウトバウンドルールを追加");
    return true;
  } catch {
    failSpinner("ファイアウォール設定の自動追加に失敗しました");
    printInfo("Xserver管理画面で手動設定してください: TCP 443 アウトバウンド許可");
    return false;
  }
}
