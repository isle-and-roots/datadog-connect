import { join } from "node:path";
import { writeSecureFile } from "../utils/secure-write.js";
import chalk from "chalk";
import type { ResourceRecord, ManualStep } from "../config/types.js";

interface SummaryData {
  sessionId: string;
  resources: ResourceRecord[];
  manualSteps: ManualStep[];
  errors: string[];
}

const RESOURCE_LABELS: Record<string, string> = {
  monitor: "アラートモニター",
  dashboard: "ダッシュボード",
  synthetic_test: "外形監視テスト",
  logs_pipeline: "ログパイプライン",
  aws_integration: "AWS統合",
  gcp_integration: "GCP統合",
  azure_integration: "Azure統合",
  service_definition: "APMサービス",
  cws_agent_policy: "ワークロード保護ポリシー",
  asm_waf_custom_rule: "WAFルール",
  asm_waf_exclusion: "WAF除外フィルター",
  asm_waf_exclusion_filter: "WAF除外フィルター",
  siem_rule: "検出ルール",
  security_monitoring_rule: "セキュリティ監視ルール",
  cspm_aws_scan_options: "AWS セキュリティスキャン",
  cspm_gcp_scan_options: "GCP セキュリティスキャン",
  cspm_azure_scan_options: "Azure セキュリティスキャン",
  sensitive_data_group: "機密データスキャングループ",
};

export function printSummary(data: SummaryData): void {
  console.log();
  console.log(chalk.bold.cyan("  📊 セットアップ完了レポート"));
  console.log(chalk.dim("  ─".repeat(25)));

  // Statistics bar
  const total = data.resources.length + data.manualSteps.length + data.errors.length;
  const successRate = total > 0
    ? Math.round((data.resources.length / (data.resources.length + data.errors.length)) * 100)
    : 100;
  const statusColor = data.errors.length === 0 ? chalk.green : data.resources.length > 0 ? chalk.yellow : chalk.red;
  const statusLabel = data.errors.length === 0 ? "全て成功" : data.resources.length > 0 ? "部分成功" : "失敗";

  console.log();
  console.log(statusColor.bold(`  ${statusLabel} (成功率 ${successRate}%)`));
  console.log(chalk.bold(`  作成: ${chalk.green(String(data.resources.length))}件 | 手動手順: ${chalk.yellow(String(data.manualSteps.length))}件 | エラー: ${chalk.red(String(data.errors.length))}件`));

  // Resources grouped by type
  if (data.resources.length > 0) {
    console.log();
    console.log(chalk.bold("  作成リソース:"));

    // Group by type for cleaner display
    const grouped = new Map<string, ResourceRecord[]>();
    for (const r of data.resources) {
      const list = grouped.get(r.type) ?? [];
      list.push(r);
      grouped.set(r.type, list);
    }

    for (const [type, items] of grouped) {
      const label = RESOURCE_LABELS[type] ?? type;
      if (items.length === 1) {
        console.log(chalk.green(`    ✅ ${label}: ${items[0].name}`));
      } else {
        console.log(chalk.green(`    ✅ ${label} (${items.length}件):`));
        for (const item of items) {
          console.log(chalk.green(`       • ${item.name}`));
        }
      }
    }
  }

  // Manual steps
  if (data.manualSteps.length > 0) {
    console.log();
    console.log(chalk.bold("  手動手順:"));
    for (const [i, step] of data.manualSteps.entries()) {
      console.log(chalk.yellow(`    📋 ${i + 1}. ${step.title}`));
      if (step.outputFile) {
        console.log(chalk.dim(`       → ${step.outputFile}`));
      }
    }
  }

  // Errors
  if (data.errors.length > 0) {
    console.log();
    console.log(chalk.bold.red("  エラー:"));
    for (const e of data.errors) {
      console.log(chalk.red(`    ❌ ${e}`));
    }
  }

  console.log();
}

export function exportSummary(data: SummaryData, outputDir: string): string {
  const reportPath = join(outputDir, "setup-report.json");
  writeSecureFile(reportPath, JSON.stringify(data, null, 2));

  // Manual steps markdown
  if (data.manualSteps.length > 0) {
    const mdPath = join(outputDir, "manual-steps.md");
    const md = [
      "# 手動手順書",
      "",
      `セッション: ${data.sessionId}`,
      `生成日: ${new Date().toISOString()}`,
      "",
      ...data.manualSteps.flatMap((step, i) => [
        `## ${i + 1}. ${step.title}`,
        "",
        step.description,
        ...(step.commands?.length
          ? ["", "```bash", ...step.commands, "```"]
          : []),
        ...(step.outputFile ? ["", `出力ファイル: \`${step.outputFile}\``] : []),
        "",
      ]),
    ].join("\n");
    writeSecureFile(mdPath, md);
  }

  return reportPath;
}
