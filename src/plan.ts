import { printBanner, printSuccess, printError, printInfo } from "./utils/prompts.js";
import { buildExecutionPlan } from "./orchestrator/plan-builder.js";
import { renderPlanAsMarkdown, renderPlanAsJson } from "./orchestrator/plan-renderer.js";
import { getSecureOutputDir, writeSecureFile } from "./utils/secure-write.js";
import { join } from "node:path";

// Register modules (side-effect imports)
import "./modules/all.js";

export interface PlanOptions {
  preset: string;
  format: "json" | "markdown";
  site: string;
  output?: string;
}

export async function runPlan(opts: PlanOptions): Promise<void> {
  printBanner();
  printInfo(`プリセット "${opts.preset}" の実行プランを生成中...`);

  let plan;
  try {
    plan = buildExecutionPlan({
      preset: opts.preset,
      site: opts.site,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`プラン生成に失敗しました: ${msg}`);
    printInfo(`利用可能なプリセット: recommended, aws, gcp, azure, security, xserver, full, custom`);
    process.exit(1);
  }

  const rendered = opts.format === "json"
    ? renderPlanAsJson(plan)
    : renderPlanAsMarkdown(plan);

  if (opts.output) {
    writeSecureFile(opts.output, rendered);
    printSuccess(`プランを出力しました: ${opts.output}`);
  } else if (opts.format === "markdown") {
    // Save to output dir and print to console
    const outputDir = getSecureOutputDir();
    const outputPath = join(outputDir, `plan-${plan.sessionId.slice(0, 8)}.md`);
    writeSecureFile(outputPath, rendered);
    console.log();
    console.log(rendered);
    console.log();
    printSuccess(`プランを保存しました: ${outputPath}`);
  } else {
    // JSON to stdout
    console.log(rendered);
  }

  printInfo(`合計 ${plan.totalCalls} 件の MCP ツール呼び出しが必要です。`);
  printInfo(`モジュール数: ${plan.modules.length}`);
}
