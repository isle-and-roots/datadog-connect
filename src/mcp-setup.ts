import { select, confirm } from "@inquirer/prompts";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { printBanner, printStep, printSuccess, printError, printInfo } from "./utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "./utils/spinner.js";
import { runPreflight, printPreflightResult, hasApiKeyFormatError } from "./utils/preflight.js";

interface McpSetupOptions {
  scope?: "local" | "user" | "project";
}

export async function runMcpSetup(opts: McpSetupOptions): Promise<void> {
  printBanner();

  // Pre-flight checks
  const preflightResult = runPreflight();
  if (preflightResult.checks.length > 0) {
    printPreflightResult(preflightResult);
    if (hasApiKeyFormatError(preflightResult)) {
      printError(
        "APIキーのフォーマットが正しくありません。環境変数を確認してから再実行してください。"
      );
      printInfo("  export DD_API_KEY=\"32文字の16進数\"");
      printInfo("  export DD_APP_KEY=\"40文字の16進数\"");
      return;
    }
  }

  printStep(1, "Datadog MCP サーバーセットアップ");

  // Check if claude CLI is available
  try {
    execSync("claude --version", { stdio: "pipe" });
  } catch {
    printError("Claude Code CLI が見つかりません。");
    printInfo("Claude Code をインストールしてください: https://claude.ai/code");
    return;
  }

  // Check if MCP server already configured
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let alreadyConfigured = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (settings.mcpServers?.datadog) {
        alreadyConfigured = true;
      }
    } catch {
      // Settings file unreadable
    }
  }

  if (alreadyConfigured) {
    printInfo("Datadog MCP サーバーは既に設定されています。");
    const reconfigure = await confirm({
      message: "再設定しますか？",
      default: false,
    });
    if (!reconfigure) return;
  }

  // Get credentials
  printStep(2, "認証情報の確認");

  const envApiKey = process.env.DD_API_KEY;
  const envAppKey = process.env.DD_APP_KEY;
  const envSite = process.env.DD_SITE;

  let apiKey = envApiKey ?? "";
  let appKey = envAppKey ?? "";
  let site = envSite ?? "datadoghq.com";

  if (apiKey && appKey) {
    printSuccess("環境変数から認証情報を検出しました");
  } else {
    printInfo("Datadog API Key と Application Key が必要です。");
    printInfo("環境変数 DD_API_KEY / DD_APP_KEY を設定するか、");
    printInfo("先に 'datadog-connect setup' を実行してキーを取得してください。");

    const proceed = await confirm({
      message: "環境変数を設定済みですか？",
      default: false,
    });

    if (!proceed) {
      printInfo("以下の手順で環境変数を設定してください:");
      console.log();
      console.log("  export DD_API_KEY=\"あなたのAPIキー\"");
      console.log("  export DD_APP_KEY=\"あなたのApplicationキー\"");
      console.log("  datadog-connect mcp");
      console.log();
      return;
    }

    // Re-check
    apiKey = process.env.DD_API_KEY ?? "";
    appKey = process.env.DD_APP_KEY ?? "";
    site = process.env.DD_SITE ?? "datadoghq.com";

    if (!apiKey || !appKey) {
      printError("DD_API_KEY と DD_APP_KEY が設定されていません。");
      return;
    }
  }

  // Select scope
  const scope = opts.scope ?? await select({
    message: "MCP サーバーの設定範囲:",
    choices: [
      { value: "user" as const, name: "ユーザー全体（全プロジェクトで使える）— おすすめ" },
      { value: "project" as const, name: "このプロジェクトのみ" },
      { value: "local" as const, name: "ローカル（このマシンのみ）" },
    ],
  });

  // Install MCP server
  printStep(3, "MCP サーバーをインストール");

  startSpinner("@winor30/mcp-server-datadog をインストール中...");

  try {
    // spawnSync の args 配列経由で渡す（シェル履歴には残らない）
    // claude mcp add <name> [options] -- <command> の順序で指定
    const args = [
      "mcp", "add",
      "datadog",
      "-s", scope,
      "-e", `DD_API_KEY=${apiKey}`,
      "-e", `DD_APP_KEY=${appKey}`,
      "-e", `DD_SITE=${site}`,
      "--",
      "npx", "-y", "@winor30/mcp-server-datadog",
    ];

    const result = spawnSync("claude", args, {
      stdio: "pipe",
    });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || "claude mcp add failed");
    }
    succeedSpinner("Datadog MCP サーバーを登録しました");
  } catch (err) {
    failSpinner("MCP サーバーの登録に失敗しました");
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    printInfo("手動で設定する場合:");
    console.log();
    console.log("  claude mcp add -e DD_API_KEY=${DD_API_KEY} -e DD_APP_KEY=${DD_APP_KEY} -e DD_SITE=${DD_SITE} datadog -- npx -y @winor30/mcp-server-datadog");
    console.log();
    return;
  }

  // Verify
  printStep(4, "接続確認");

  startSpinner("MCP サーバーの接続を確認中...");
  try {
    const result = execSync("claude mcp list", { stdio: "pipe" }).toString();
    if (result.includes("datadog")) {
      succeedSpinner("Datadog MCP サーバーが正常に接続されました");
    } else {
      failSpinner("MCP サーバーが一覧に見つかりません");
    }
  } catch {
    succeedSpinner("登録完了（次回 Claude Code 起動時に有効になります）");
  }

  // Summary
  console.log();
  printSuccess("セットアップ完了！");
  console.log();
  console.log("  Claude Code で以下のことができるようになりました:");
  console.log("  ・Datadog のメトリクスを取得・分析");
  console.log("  ・モニターの作成・編集");
  console.log("  ・ログの検索・分析");
  console.log("  ・ダッシュボードの操作");
  console.log("  ・インシデント管理");
  console.log();
  console.log("  次のステップ:");
  console.log("  ・datadog-connect setup   — セットアップランブックを生成");
  console.log("  ・datadog-connect plan    — プリセットからプランを直接生成");
  console.log();
  console.log("  Claude Code で「Datadogの直近のアラートを確認して」と聞いてみてください");
  console.log();
}
