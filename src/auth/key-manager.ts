import { select, password } from "@inquirer/prompts";
import chalk from "chalk";
import { DATADOG_SITES } from "../config/constants.js";
import type { Credentials, DatadogSite } from "../config/types.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";
import { printStep, printInfo, printError } from "../utils/prompts.js";
import { getBrowserController } from "../browser/browser-controller.js";
import { fetchDatadogApiKey, createDatadogAppKey } from "../browser/datadog-browser.js";

export async function promptCredentials(profile: string): Promise<Credentials> {
  printStep(1, "認証");

  // 環境変数チェック
  const envApiKey = process.env.DD_API_KEY;
  const envAppKey = process.env.DD_APP_KEY;
  const envSite = process.env.DD_SITE as DatadogSite | undefined;

  if (envApiKey && envAppKey) {
    printInfo("環境変数から認証情報を使用します");
    const creds: Credentials = {
      site: envSite ?? "datadoghq.com",
      apiKey: envApiKey,
      appKey: envAppKey,
      profile,
    };
    // validate format only (no API call in MCP Harness mode)
    startSpinner("認証情報を検証中...");
    const valid = validateCredentialFormat(creds);
    if (!valid) {
      failSpinner("環境変数の認証情報の形式が無効です");
      throw new Error("Invalid credentials format from environment");
    }
    succeedSpinner("認証OK (環境変数)");
    return creds;
  }

  // ブラウザ自動取得オプション
  const browserCtrl = getBrowserController();
  if (await browserCtrl.isAvailable()) {
    const useBrowser = await select({
      message: "認証情報の取得方法:",
      choices: [
        { value: "browser", name: "🌐 ブラウザで自動取得（おすすめ）— ログインするだけでOK" },
        { value: "manual", name: "⌨️  手動入力 — キーを自分でコピペする" },
      ],
    });

    if (useBrowser === "browser") {
      const ready = await browserCtrl.ensureBrowser();
      if (ready) {
        await browserCtrl.launch();

        // サイト選択（ブラウザモードでも必要）
        const site = await select<DatadogSite>({
          message: "Datadogサイト:",
          choices: DATADOG_SITES.map((s) => ({ value: s.value, name: s.label })),
        });

        console.log();
        console.log("  ┌─────────────────────────────────────────────┐");
        console.log("  │  Datadog のログイン画面が開きました。        │");
        console.log("  │  いつも通りログインしてください。            │");
        console.log("  │  ログイン後、自動で次に進みます。            │");
        console.log("  │                                              │");
        console.log("  │  💡 SSO・二要素認証もそのまま使えます。      │");
        console.log("  └─────────────────────────────────────────────┘");
        console.log();

        const apiKey = await fetchDatadogApiKey(browserCtrl, site);
        const appKey = apiKey ? await createDatadogAppKey(browserCtrl, site) : null;

        await browserCtrl.close();

        if (apiKey && appKey) {
          const creds: Credentials = { site, apiKey, appKey, profile };
          startSpinner("認証情報を検証中...");
          const valid = validateCredentialFormat(creds);
          if (valid) {
            succeedSpinner("認証OK (ブラウザ)");
            return creds;
          }
          failSpinner("取得したキーの形式が無効です。手動入力に切り替えます。");
        } else if (apiKey) {
          printInfo("Application Key を手動で入力してください。");
          const manualAppKey = await password({ message: "Application Key:", mask: "*" });
          const creds: Credentials = { site, apiKey, appKey: manualAppKey, profile };
          startSpinner("認証情報を検証中...");
          const valid = validateCredentialFormat(creds);
          if (valid) {
            succeedSpinner("認証OK (API Key: ブラウザ + App Key: 手動)");
            return creds;
          }
          failSpinner("認証情報の形式が無効です。手動入力に切り替えます。");
        } else {
          await browserCtrl.close();
          printInfo("ブラウザでの取得に失敗しました。手動入力に切り替えます。");
        }
      }
    }
  }

  // 以下、手動入力フロー（最大3回リトライ）
  console.log();
  console.log(chalk.dim("  ┌─────────────────────────────────────────────────┐"));
  console.log(chalk.dim("  │  💡 サイトの見分け方:                           │"));
  console.log(chalk.dim("  │    ログインURLが app.datadoghq.com → US1       │"));
  console.log(chalk.dim("  │    ログインURLが ap1.datadoghq.com → AP1       │"));
  console.log(chalk.dim("  │    ログインURLが app.datadoghq.eu  → EU        │"));
  console.log(chalk.dim("  │    日本のお客様は通常 US1 または AP1 です       │"));
  console.log(chalk.dim("  │                                                 │"));
  console.log(chalk.dim("  │  キーの場所:                                    │"));
  console.log(chalk.dim("  │    Organization Settings > API Keys             │"));
  console.log(chalk.dim("  │    Organization Settings > Application Keys     │"));
  console.log(chalk.dim("  └─────────────────────────────────────────────────┘"));
  console.log();

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      printInfo(`再試行 (${attempt}/3) — API Key と Application Key を確認してください。`);
    }

    const site = await select<DatadogSite>({
      message: "Datadogサイト:",
      choices: DATADOG_SITES.map((s) => ({ value: s.value, name: s.label })),
    });

    const apiKey = await password({ message: "API Key:", mask: "*" });
    const appKey = await password({ message: "Application Key:", mask: "*" });

    const creds: Credentials = { site, apiKey, appKey, profile };

    startSpinner("認証情報を検証中...");
    const valid = validateCredentialFormat(creds);
    if (valid) {
      succeedSpinner("認証OK");
      return creds;
    }

    failSpinner(`認証情報の形式が無効です (${attempt}/3)`);
  }

  // 3回失敗
  printError("認証に3回失敗しました。以下を確認してください:");
  printInfo("  1. API Key が正しいか (Organization Settings > API Keys)");
  printInfo("  2. Application Key が正しいか (Organization Settings > Application Keys)");
  printInfo("  3. 選択したDatadogサイトが正しいか");
  throw new Error("認証に3回失敗しました");
}

/**
 * Validates the format of Datadog credentials without making any API calls.
 * Datadog API keys are 32 hex characters.
 * Datadog Application keys are 40 hex characters.
 */
function validateCredentialFormat(creds: Credentials): boolean {
  const apiKeyValid = /^[0-9a-f]{32}$/i.test(creds.apiKey);
  const appKeyValid = /^[0-9a-f]{40}$/i.test(creds.appKey);
  return apiKeyValid && appKeyValid;
}
