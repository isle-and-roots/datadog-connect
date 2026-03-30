import { execSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import { printInfo, printSuccess, printError } from "../utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";

// Playwright の型だけ import（実行時は dynamic import）
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /** Playwright がインストール済みか確認 */
  async isAvailable(): Promise<boolean> {
    try {
      await import("playwright");
      return true;
    } catch {
      return false;
    }
  }

  /** Chromium 未DLなら自動インストールを提案 */
  async ensureBrowser(): Promise<boolean> {
    if (!(await this.isAvailable())) {
      printInfo("ブラウザ自動取得には Playwright が必要です。");
      printInfo("npm install playwright && npx playwright install chromium を実行してください。");
      return false;
    }

    // Chromium が存在するか確認（launch して即閉じる）
    try {
      const pw = await import("playwright");
      const testBrowser = await pw.chromium.launch({ headless: true });
      await testBrowser.close();
      return true;
    } catch {
      // Chromium がDLされていない
      const shouldInstall = await confirm({
        message: "ブラウザ (Chromium) をダウンロードしますか？ (約100MB)",
        default: true,
      });
      if (!shouldInstall) return false;

      startSpinner("Chromium をダウンロード中...");
      try {
        execSync("npx playwright install chromium", { stdio: "pipe" });
        succeedSpinner("Chromium のダウンロード完了");
        return true;
      } catch {
        failSpinner("Chromium のダウンロードに失敗しました");
        return false;
      }
    }
  }

  /** ブラウザを起動（常にheaded = 画面表示） */
  async launch(): Promise<Page> {
    const pw = await import("playwright");
    this.browser = await pw.chromium.launch({
      headless: false,
      args: process.env.PLAYWRIGHT_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
    });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    return this.page;
  }

  /** 特定のURLパターンに遷移するまで待つ（ログイン完了検出用） */
  async waitForUrl(urlPattern: RegExp, timeoutMs = 300000): Promise<void> {
    if (!this.page) throw new Error("ブラウザが起動していません");
    await this.page.waitForURL(urlPattern, { timeout: timeoutMs });
  }

  /** セレクタのテキスト取得 */
  async getText(selector: string): Promise<string> {
    if (!this.page) throw new Error("ブラウザが起動していません");
    const el = await this.page.waitForSelector(selector, { timeout: 30000 });
    return (await el?.textContent()) ?? "";
  }

  /** URLに移動 */
  async goto(url: string): Promise<void> {
    if (!this.page) throw new Error("ブラウザが起動していません");
    await this.page.goto(url, { waitUntil: "networkidle" });
  }

  /** クリック */
  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("ブラウザが起動していません");
    await this.page.click(selector);
  }

  /** 入力 */
  async fill(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("ブラウザが起動していません");
    await this.page.fill(selector, value);
  }

  /** ページ取得 */
  getPage(): Page | null {
    return this.page;
  }

  /** ブラウザを閉じる */
  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}

/** シングルトンインスタンス */
let instance: BrowserController | null = null;

export function getBrowserController(): BrowserController {
  if (!instance) instance = new BrowserController();
  return instance;
}
