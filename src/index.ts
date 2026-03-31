import { Command } from "commander";
import { APP_NAME, APP_VERSION } from "./config/constants.js";
import { runSetup } from "./wizard.js";
import { runResume } from "./resume.js";
import { runRollback } from "./rollback.js";
import { runMcpSetup } from "./mcp-setup.js";

const program = new Command()
  .name("datadog-connect")
  .description(`${APP_NAME} — かんたんセットアップウィザード`)
  .version(APP_VERSION);

program
  .command("setup")
  .description("Datadogセットアップウィザードを開始")
  .option("-p, --profile <name>", "認証プロファイル名", "default")
  .action(async (opts) => {
    await runSetup({ profile: opts.profile });
  });

program
  .command("resume")
  .description("中断したセッションを再開")
  .option("-s, --session <id>", "セッションID")
  .action(async (opts) => {
    await runResume({ sessionId: opts.session });
  });

program
  .command("rollback")
  .description("作成リソースをロールバック")
  .option("-s, --session <id>", "セッションID")
  .action(async (opts) => {
    await runRollback({ sessionId: opts.session });
  });

program
  .command("mcp")
  .description("Datadog MCP サーバーを Claude Code に接続")
  .option("-s, --scope <scope>", "設定範囲 (local/user/project)")
  .option("--self", "datadog-connect 自体を MCP サーバーとして登録（自然言語でセットアップ可能に）")
  .action(async (opts) => {
    await runMcpSetup({ scope: opts.scope, self: opts.self });
  });

program.parse();
