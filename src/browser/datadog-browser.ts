import { BrowserController } from "./browser-controller.js";
import { printInfo, printSuccess } from "../utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";

/**
 * Datadog API Key をブラウザで取得
 * 1. Datadog API Keys ページに移動
 * 2. ユーザーのログインを待つ
 * 3. ページからAPIキーを取得（最初のキーのコピーボタン or テキスト）
 */
export async function fetchDatadogApiKey(
  browser: BrowserController,
  site: string
): Promise<string | null> {
  try {
    const baseUrl = site === "datadoghq.eu" ? "https://app.datadoghq.eu" : `https://app.${site}`;
    // デフォルトは https://app.datadoghq.com

    printInfo("Datadog のログイン画面を開きます。ログインしてください。");
    printInfo("SSO・二要素認証もそのまま使えます。");

    await browser.goto(`${baseUrl}/account/login`);

    startSpinner("ログイン完了を待っています...");
    // ログイン完了 = /organization-settings or /dashboard 等に遷移
    await browser.waitForUrl(/\/(dashboard|organization-settings|account\/settings)/, 300000);
    succeedSpinner("ログイン確認！");

    // API Keys ページに移動
    await browser.goto(`${baseUrl}/organization-settings/api-keys`);
    // ページロード待ち
    await new Promise(resolve => setTimeout(resolve, 3000));

    // API Key を取得（テーブルの最初のキー）
    const page = browser.getPage();
    if (!page) return null;

    // Datadog の API Keys ページ構造: キーはテーブルに表示
    // セレクタはDatadog UIに依存するため、複数パターンを試す
    const apiKey = await page.evaluate(() => {
      // パターン1: data-testid
      const keyEl = document.querySelector('[data-testid="api-key-value"]');
      if (keyEl?.textContent) return keyEl.textContent.trim();

      // パターン2: テーブルのキーセル
      const cells = document.querySelectorAll("td");
      for (const cell of cells) {
        const text = cell.textContent?.trim() ?? "";
        // API Key は32文字の16進文字列
        if (/^[a-f0-9]{32}$/.test(text)) return text;
      }

      // パターン3: コピーボタンの隣のテキスト
      const codeEls = document.querySelectorAll("code, pre, .key-value");
      for (const el of codeEls) {
        const text = el.textContent?.trim() ?? "";
        if (/^[a-f0-9]{32}$/.test(text)) return text;
      }

      return null;
    });

    if (apiKey) {
      printSuccess("API Key を取得しました");
      return apiKey;
    }

    // 自動取得できなかった場合、ユーザーに手動コピーを促す
    printInfo("API Key を自動取得できませんでした。");
    printInfo("画面に表示されている API Key をコピーしてください。");
    return null;
  } catch (err) {
    failSpinner("API Key 取得に失敗しました");
    return null;
  }
}

/**
 * Datadog Application Key をブラウザで作成・取得
 */
export async function createDatadogAppKey(
  browser: BrowserController,
  site: string
): Promise<string | null> {
  try {
    const baseUrl = site === "datadoghq.eu" ? "https://app.datadoghq.eu" : `https://app.${site}`;

    await browser.goto(`${baseUrl}/organization-settings/application-keys`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    const page = browser.getPage();
    if (!page) return null;

    // "New Key" ボタンをクリック
    startSpinner("Application Key を作成中...");

    // New Key ボタンを探してクリック
    const newKeyBtn = await page.$('button:has-text("New Key")')
      ?? await page.$('[data-testid="create-app-key"]')
      ?? await page.$('button:has-text("新しいキー")');

    if (newKeyBtn) {
      await newKeyBtn.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 名前入力
      const nameInput = await page.$('input[name="name"]') ?? await page.$('input[placeholder*="name"]');
      if (nameInput) {
        const keyName = `datadog-connect-${new Date().toISOString().split("T")[0]}`;
        await nameInput.fill(keyName);
      }

      // Create ボタンクリック
      const createBtn = await page.$('button:has-text("Create")') ?? await page.$('button:has-text("作成")');
      if (createBtn) {
        await createBtn.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // OTR (One-Time Read) のキーを取得
      const appKey = await page.evaluate(() => {
        const els = document.querySelectorAll("code, pre, input[readonly], .key-value, [data-testid='app-key-value']");
        for (const el of els) {
          const text = (el as HTMLInputElement).value || el.textContent?.trim() || "";
          // App Key は40文字の16進文字列
          if (/^[a-f0-9]{40}$/.test(text)) return text;
        }
        return null;
      });

      if (appKey) {
        succeedSpinner("Application Key を作成しました");
        return appKey;
      }
    }

    failSpinner("Application Key の自動作成に失敗しました");
    printInfo("画面から手動で Application Key を作成してコピーしてください。");
    return null;
  } catch {
    failSpinner("Application Key 作成に失敗しました");
    return null;
  }
}
