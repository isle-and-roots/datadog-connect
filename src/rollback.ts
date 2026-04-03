import { confirm } from "@inquirer/prompts";
import { loadLatestSession, loadSession } from "./state/state-manager.js";
import { loadJournal } from "./state/operation-journal.js";
import { buildRollbackPlan } from "./orchestrator/rollback-planner.js";
import { renderPlanAsMarkdown } from "./orchestrator/plan-renderer.js";
import {
  printBanner,
  printSuccess,
  printError,
  printInfo,
} from "./utils/prompts.js";
import { writeSecureFile } from "./utils/secure-write.js";
import { getSecureOutputDir } from "./utils/secure-write.js";
import { join } from "node:path";
import type { ExecutionPlan } from "./orchestrator/mcp-call.js";
import { randomUUID } from "node:crypto";

export interface RollbackOptions {
  sessionId?: string;
  dryRun?: boolean;
}

export async function runRollback(opts: RollbackOptions): Promise<void> {
  printBanner();

  const dryRun = opts.dryRun ?? false;

  // セッション解決
  const session = opts.sessionId
    ? loadSession(opts.sessionId)
    : loadLatestSession();

  if (!session) {
    printError(
      opts.sessionId
        ? `セッション "${opts.sessionId}" が見つかりません。`
        : "ロールバック可能なセッションが見つかりません。"
    );
    process.exit(1);
  }

  // ジャーナル読み込み
  const journal = loadJournal(session.sessionId);
  if (!journal || journal.resources.length === 0) {
    printInfo(
      `セッション ${session.sessionId} にロールバック対象のリソースはありません。`
    );
    return;
  }

  const resources = [...journal.resources];

  console.log();
  console.log(
    `  セッション: ${session.sessionId} (${session.startedAt.slice(0, 10)})`
  );
  console.log(`  ロールバック対象: ${resources.length} リソース`);
  console.log();

  for (const r of resources) {
    console.log(`    • [${r.type}] ${r.name} (${r.id})`);
  }
  console.log();

  if (dryRun) {
    // Dry-run: show resources and rollback plan preview without executing
    const rollbackCalls = buildRollbackPlan(resources);

    const plan: ExecutionPlan = {
      sessionId: randomUUID(),
      site: session.site,
      preset: "rollback",
      createdAt: new Date().toISOString(),
      modules: [
        {
          moduleId: "rollback",
          moduleName: "Rollback",
          category: "cloud",
          calls: rollbackCalls,
          manualSteps: [],
          verificationCalls: [],
        },
      ],
      totalCalls: rollbackCalls.length,
    };

    const markdown = renderPlanAsMarkdown(plan);
    console.log();
    console.log(markdown);
    console.log();
    printInfo("[DRY RUN] 実際の削除は行いません");
    printInfo(`合計 ${rollbackCalls.length} 件の削除操作がプレビューされました。`);
    return;
  }

  const ok = await confirm({
    message: "上記のリソースのロールバックプランを生成しますか？",
    default: true,
  });

  if (!ok) {
    printInfo("ロールバックをキャンセルしました。");
    return;
  }

  // ロールバックプランを生成（MCPツール呼び出しプラン）
  const rollbackCalls = buildRollbackPlan(resources);

  const plan: ExecutionPlan = {
    sessionId: randomUUID(),
    site: session.site,
    preset: "rollback",
    createdAt: new Date().toISOString(),
    modules: [
      {
        moduleId: "rollback",
        moduleName: "Rollback",
        category: "cloud",
        calls: rollbackCalls,
        manualSteps: [],
        verificationCalls: [],
      },
    ],
    totalCalls: rollbackCalls.length,
  };

  const markdown = renderPlanAsMarkdown(plan);

  // 出力先に保存
  const outputDir = getSecureOutputDir();
  const outputPath = join(outputDir, `rollback-${session.sessionId.slice(0, 8)}.md`);
  writeSecureFile(outputPath, markdown);

  console.log();
  printSuccess("ロールバックプランを生成しました！");
  console.log();
  console.log("  生成されたプランの MCP ツール呼び出しを実行してください:");
  console.log(`  ${outputPath}`);
  console.log();
  console.log(`  合計 ${rollbackCalls.length} 件の削除操作が必要です。`);
  console.log("  Datadog MCP サーバーで各ツール呼び出しを実行してください。");
}
