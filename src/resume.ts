import { confirm } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { loadLatestSession, loadSession } from "./state/state-manager.js";
import { getModules } from "./modules/registry.js";
import { printBanner, printStep, printSuccess, printError, printInfo } from "./utils/prompts.js";
import { buildExecutionPlanFromIds } from "./orchestrator/plan-builder.js";
import { renderPlanAsMarkdown, renderPlanAsJson } from "./orchestrator/plan-renderer.js";
import { getSecureOutputDir, writeSecureFile } from "./utils/secure-write.js";
import { join } from "node:path";

// Register modules (side-effect imports)
import "./modules/all.js";

interface ResumeOptions {
  sessionId?: string;
  format?: string;
}

export async function runResume(opts: ResumeOptions): Promise<void> {
  printBanner();
  printStep(1, "セッション復元");

  const session = opts.sessionId
    ? loadSession(opts.sessionId)
    : loadLatestSession();

  if (!session) {
    printError("復元可能なセッションが見つかりません。");
    printInfo("datadog-connect setup で新しいセッションを開始してください。");
    return;
  }

  // 失敗/スキップされたモジュールを抽出
  const failedModuleEntries = Object.entries(session.modules)
    .filter(([, m]) => m.state === "failed" || m.state === "skipped")
    .map(([id, m]) => ({ id, state: m.state, errors: m.errors }));

  const completedModules = Object.entries(session.modules)
    .filter(([, m]) => m.state === "completed")
    .map(([id]) => id);

  printInfo(`セッション: ${session.sessionId}`);
  printInfo(`開始日時: ${session.startedAt}`);
  printSuccess(`完了済み: ${completedModules.length}モジュール`);

  if (failedModuleEntries.length === 0) {
    printSuccess("全モジュールが完了済みです。再実行の必要はありません。");
    return;
  }

  printError(`未完了: ${failedModuleEntries.length}モジュール`);
  for (const mod of failedModuleEntries) {
    printError(`  ${mod.id} (${mod.state})`);
    for (const err of mod.errors) {
      printInfo(`    - ${err}`);
    }
  }

  const shouldResume = await confirm({
    message: `${failedModuleEntries.length}件の未完了モジュールの再実行プランを生成しますか？`,
    default: true,
  });

  if (!shouldResume) return;

  // 認証（サイト情報の確認のみ）
  printStep(2, "認証");
  await promptCredentials(session.profile);

  // 失敗モジュールの再実行プランを生成
  printStep(3, "再実行プランを生成");

  const allModules = getModules();
  const failedIds = failedModuleEntries
    .map(({ id }) => id)
    .filter((id) => allModules.some((m) => m.id === id));

  if (failedIds.length === 0) {
    printError("対応するモジュールが見つかりません。");
    return;
  }

  let plan;
  try {
    plan = buildExecutionPlanFromIds({
      moduleIds: failedIds,
      site: session.site,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`プラン生成に失敗しました: ${msg}`);
    return;
  }

  const useJson = opts.format === "json";
  const output = useJson ? renderPlanAsJson(plan) : renderPlanAsMarkdown(plan);
  const ext = useJson ? "json" : "md";

  // 出力先に保存
  const outputDir = getSecureOutputDir();
  const reportPath = join(outputDir, `resume-${session.sessionId.slice(0, 8)}.${ext}`);
  writeSecureFile(reportPath, output);

  console.log();
  console.log(output);
  console.log();
  printSuccess(`再実行プランを保存しました: ${reportPath}`);
  printInfo(`合計 ${plan.totalCalls} 件の MCP ツール呼び出しが必要です。`);
  printInfo(`上記のランブックに従って MCP ツールを実行してください。`);
}
