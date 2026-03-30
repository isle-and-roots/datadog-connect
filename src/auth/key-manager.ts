import { select, password } from "@inquirer/prompts";
import { client as ddClient, v1 } from "@datadog/datadog-api-client";
import { DATADOG_SITES } from "../config/constants.js";
import type { Credentials, DatadogSite } from "../config/types.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";
import { printStep, printInfo } from "../utils/prompts.js";

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
