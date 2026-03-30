import { confirm } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { createDatadogClient } from "./client/datadog-client.js";
import { loadLatestSession, loadSession } from "./state/state-manager.js";
import { loadJournal } from "./state/operation-journal.js";
import {
  printBanner,
  printSuccess,
  printError,
  printInfo,
} from "./utils/prompts.js";
import type { ResourceRecord } from "./config/types.js";
import type { DatadogClient } from "./client/datadog-client.js";

export interface RollbackOptions {
  sessionId?: string;
}

async function deleteResource(
  client: DatadogClient,
  resource: ResourceRecord
): Promise<void> {
  const { type, id, name } = resource;

  switch (type) {
    case "monitor":
      await client.v1.monitors.deleteMonitor({
        monitorId: parseInt(id, 10),
      });
      break;

    case "dashboard":
      await client.v1.dashboards.deleteDashboard({ dashboardId: id });
      break;

    case "synthetic_test":
      await client.v1.synthetics.deleteTests({
        body: { publicIds: [id] },
      });
      break;

    case "logs_pipeline":
      await client.v1.logsPipelines.deleteLogsPipeline({ pipelineId: id });
      break;

    case "cws_agent_policy":
      await client.security.csmThreats.deleteCSMThreatsAgentPolicy({
        policyId: id,
      });
      break;

    case "asm_waf_rule":
      await client.security.asm.deleteApplicationSecurityWafCustomRule({
        customRuleId: id,
      });
      break;

    case "asm_waf_exclusion":
      await client.security.asm.deleteApplicationSecurityWafExclusionFilter({
        exclusionFilterId: id,
      });
      break;

    case "security_monitoring_rule":
      await client.security.monitoring.deleteSecurityMonitoringRule({
        ruleId: id,
      });
      break;

    case "aws_integration":
    case "gcp_integration":
    case "azure_integration":
    case "service_definition":
      throw new SkipError(
        `${type} (${name}) は自動削除できません。Datadog コンソールから手動で削除してください。`
      );

    default:
      throw new SkipError(
        `不明なリソースタイプ "${type}" (${name}) はスキップします。手動削除が必要な場合は Datadog コンソールを確認してください。`
      );
  }
}

class SkipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipError";
  }
}

export async function runRollback(opts: RollbackOptions): Promise<void> {
  printBanner();

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

  const resources = [...journal.resources].reverse();

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

  const ok = await confirm({
    message: "上記のリソースをすべて削除しますか？",
    default: false,
  });

  if (!ok) {
    printInfo("ロールバックをキャンセルしました。");
    return;
  }

  // 認証
  const creds = await promptCredentials(session.profile);
  const client = createDatadogClient(creds);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const resource of resources) {
    try {
      await deleteResource(client, resource);
      printSuccess(`削除完了: [${resource.type}] ${resource.name}`);
      succeeded++;
    } catch (err) {
      if (err instanceof SkipError) {
        printInfo(err.message);
        skipped++;
      } else {
        const message =
          err instanceof Error ? err.message : String(err);
        printError(`削除失敗: [${resource.type}] ${resource.name} — ${message}`);
        failed++;
      }
    }
  }

  console.log();
  console.log("  ─── ロールバック結果 ───────────────────────");
  console.log(`    削除成功: ${succeeded}`);
  console.log(`    スキップ: ${skipped}`);
  console.log(`    失敗    : ${failed}`);
  console.log("  ────────────────────────────────────────────");
  console.log();

  if (failed > 0) {
    printError("一部のリソースの削除に失敗しました。Datadog コンソールで確認してください。");
    process.exit(1);
  } else {
    printSuccess("ロールバック完了。");
  }
}
