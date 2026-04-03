import { Command } from "commander";
import { APP_NAME, APP_VERSION } from "./config/constants.js";
import { runSetup } from "./wizard.js";
import { runResume } from "./resume.js";
import { runRollback } from "./rollback.js";
import { runMcpSetup } from "./mcp-setup.js";
import { runPlan } from "./plan.js";

const program = new Command()
  .name("datadog-connect")
  .description(`${APP_NAME} — Datadog MCP ハーネス`)
  .version(APP_VERSION);

program
  .command("setup")
  .description("Datadogセットアップウィザードを開始（MCP実行プランを生成）")
  .option("-p, --profile <name>", "認証プロファイル名", "default")
  .action(async (opts) => {
    await runSetup({ profile: opts.profile });
  });

program
  .command("plan")
  .description("プリセットに基づく実行プランを直接生成")
  .option("--preset <name>", "プリセット名 (recommended, aws, gcp, azure, security, xserver, full, custom)", "recommended")
  .option("--format <fmt>", "出力形式 (json | markdown)", "markdown")
  .option("--site <site>", "Datadogサイト", "datadoghq.com")
  .option("--output <path>", "出力ファイルパス（省略時は標準出力）")
  .action(async (opts) => {
    await runPlan({ preset: opts.preset, format: opts.format, site: opts.site, output: opts.output });
  });

program
  .command("resume")
  .description("中断したセッションのプランを再生成")
  .option("-s, --session <id>", "セッションID")
  .action(async (opts) => {
    await runResume({ sessionId: opts.session });
  });

program
  .command("rollback")
  .description("作成リソースのロールバックプランを生成")
  .option("-s, --session <id>", "セッションID")
  .action(async (opts) => {
    await runRollback({ sessionId: opts.session });
  });

program
  .command("mcp")
  .description("公式 Datadog MCP サーバーを Claude Code に接続")
  .option("-s, --scope <scope>", "設定範囲 (local/user/project)")
  .action(async (opts) => {
    await runMcpSetup({ scope: opts.scope });
  });

program.parse();
