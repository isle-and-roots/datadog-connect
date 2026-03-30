import { BrowserController } from "./browser-controller.js";
import { printInfo, printSuccess } from "../utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";

/**
 * AWS Account ID をブラウザで取得
 */
export async function fetchAwsAccountId(browser: BrowserController): Promise<string | null> {
  try {
    printInfo("AWS コンソールを開きます。ログインしてください。");

    await browser.goto("https://console.aws.amazon.com/");

    startSpinner("AWSログイン完了を待っています...");
    await browser.waitForUrl(/console\.aws\.amazon\.com\/(console\/home|billing|iam)/, 300000);
    succeedSpinner("AWSログイン確認！");

    // Account ID ページに移動
    await browser.goto("https://console.aws.amazon.com/billing/home#/account");
    await new Promise(resolve => setTimeout(resolve, 3000));

    const page = browser.getPage();
    if (!page) return null;

    const accountId = await page.evaluate(() => {
      // Account ID は12桁の数字
      const bodyText = document.body.innerText;
      const match = bodyText.match(/\b(\d{4}-?\d{4}-?\d{4})\b/);
      if (match) return match[1].replace(/-/g, "");

      // 別パターン: Account ID ラベルの隣
      const labels = document.querySelectorAll("span, div, td");
      for (const label of labels) {
        if (/account\s*id/i.test(label.textContent ?? "")) {
          const next = label.nextElementSibling;
          const text = next?.textContent?.trim().replace(/-/g, "") ?? "";
          if (/^\d{12}$/.test(text)) return text;
        }
      }
      return null;
    });

    if (accountId && /^\d{12}$/.test(accountId)) {
      printSuccess(`Account ID: ${accountId}`);
      return accountId;
    }

    printInfo("Account ID を自動取得できませんでした。画面で確認してください。");
    return null;
  } catch {
    failSpinner("AWS Account ID 取得に失敗しました");
    return null;
  }
}

/**
 * GCP Project ID をブラウザで取得
 */
export async function fetchGcpProjectId(browser: BrowserController): Promise<string | null> {
  try {
    printInfo("GCP コンソールを開きます。ログインしてください。");

    await browser.goto("https://console.cloud.google.com/");

    startSpinner("GCPログイン完了を待っています...");
    await browser.waitForUrl(/console\.cloud\.google\.com\/(?!.*(?:auth|signin|o\/oauth2))/, 300000);
    succeedSpinner("GCPログイン確認！");

    // IAM 設定ページに遷移（Project ID が表示される）
    await browser.goto("https://console.cloud.google.com/iam-admin/settings");
    await new Promise(resolve => setTimeout(resolve, 5000)); // GCPは描画が遅い

    const page = browser.getPage();
    if (!page) return null;

    const projectId = await page.evaluate(() => {
      // パターン1: URLから
      const urlMatch = window.location.href.match(/[?&]project=([^&]+)/);
      if (urlMatch) return urlMatch[1];

      // パターン2: ページ内のProject ID表示
      const bodyText = document.body.innerText;
      const idMatch = bodyText.match(/プロジェクト ID[:\s]+([a-z][a-z0-9-]{4,28}[a-z0-9])/i)
        ?? bodyText.match(/Project ID[:\s]+([a-z][a-z0-9-]{4,28}[a-z0-9])/i);
      if (idMatch) return idMatch[1];

      // パターン3: data-project-id
      const els = document.querySelectorAll("[data-project-id]");
      if (els.length > 0) return els[0].getAttribute("data-project-id");

      // パターン4: プロジェクトセレクターからテキスト抽出
      const projSelector = document.querySelector('[aria-label*="project" i], [data-testid*="project"]');
      if (projSelector?.textContent) {
        const text = projSelector.textContent.trim();
        if (/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(text)) return text;
      }

      return null;
    });

    if (projectId) {
      printSuccess(`Project ID: ${projectId}`);
      return projectId;
    }

    printInfo("Project ID を自動取得できませんでした。画面で確認してください。");
    return null;
  } catch {
    failSpinner("GCP Project ID 取得に失敗しました");
    return null;
  }
}

/**
 * Azure Subscription ID をブラウザで取得
 */
export async function fetchAzureSubscriptionId(browser: BrowserController): Promise<string | null> {
  try {
    printInfo("Azure ポータルを開きます。ログインしてください。");

    await browser.goto("https://portal.azure.com/");

    startSpinner("Azureログイン完了を待っています...");
    await browser.waitForUrl(/portal\.azure\.com/, 300000);
    succeedSpinner("Azureログイン確認！");

    // Subscriptions ページに移動
    await browser.goto("https://portal.azure.com/#blade/Microsoft_Azure_Billing/SubscriptionsBlade");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const page = browser.getPage();
    if (!page) return null;

    const subscriptionId = await page.evaluate(() => {
      // UUID パターンのサブスクリプションID
      const bodyText = document.body.innerText;
      const match = bodyText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return match ? match[0] : null;
    });

    if (subscriptionId) {
      printSuccess(`Subscription ID: ${subscriptionId}`);
      return subscriptionId;
    }

    printInfo("Subscription ID を自動取得できませんでした。画面で確認してください。");
    return null;
  } catch {
    failSpinner("Azure Subscription ID 取得に失敗しました");
    return null;
  }
}
