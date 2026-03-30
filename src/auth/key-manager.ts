import { select, password } from "@inquirer/prompts";
import { client as ddClient, v1 } from "@datadog/datadog-api-client";
import { DATADOG_SITES } from "../config/constants.js";
import type { Credentials, DatadogSite } from "../config/types.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";
import { printStep, printInfo } from "../utils/prompts.js";
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
    // validate
    startSpinner("認証を検証中...");
    const valid = await validateCredentials(creds);
    if (!valid) {
      failSpinner("環境変数の認証情報が無効です");
      throw new Error("Invalid credentials from environment");
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
          startSpinner("認証を検証中...");
          const valid = await validateCredentials(creds);
          if (valid) {
            succeedSpinner("認証OK (ブラウザ)");
            return creds;
          }
          failSpinner("取得したキーが無効です。手動入力に切り替えます。");
        } else if (apiKey) {
          printInfo("Application Key を手動で入力してください。");
          const manualAppKey = await password({ message: "Application Key:", mask: "*" });
          const creds: Credentials = { site, apiKey, appKey: manualAppKey, profile };
          startSpinner("認証を検証中...");
          const valid = await validateCredentials(creds);
          if (valid) {
            succeedSpinner("認証OK (API Key: ブラウザ + App Key: 手動)");
            return creds;
          }
          failSpinner("認証に失敗しました。手動入力に切り替えます。");
        } else {
          printInfo("ブラウザでの取得に失敗しました。手動入力に切り替えます。");
        }
      }
    }
  }

  // 以下、既存の手動入力フロー
  const site = await select<DatadogSite>({
    message: "Datadogサイト:",
    choices: DATADOG_SITES.map((s) => ({ value: s.value, name: s.label })),
  });

  const apiKey = await password({
    message: "API Key:",
    mask: "*",
  });

  const appKey = await password({
    message: "Application Key:",
    mask: "*",
  });

  const creds: Credentials = { site, apiKey, appKey, profile };

  // Validate
  startSpinner("認証を検証中...");
  const valid = await validateCredentials(creds);
  if (!valid) {
    failSpinner("認証失敗 — API Key または Application Key が無効です");
    throw new Error("Invalid credentials");
  }
  succeedSpinner("認証OK");

  return creds;
}

async function validateCredentials(creds: Credentials): Promise<boolean> {
  try {
    const config = ddClient.createConfiguration({
      authMethods: {
        apiKeyAuth: creds.apiKey,
        appKeyAuth: creds.appKey,
      },
    });
    config.setServerVariables({ site: creds.site });

    const api = new v1.AuthenticationApi(config);
    const resp = await api.validate();
    return resp.valid === true;
  } catch {
    return false;
  }
}
