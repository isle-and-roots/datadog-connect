import { createDatadogClient } from "../client/datadog-client.js";
import { loadLatestSession, loadSession } from "../state/state-manager.js";
import { loadJournal } from "../state/operation-journal.js";
import type { DatadogSite, ResourceRecord } from "../config/types.js";
import type { DatadogClient } from "../client/datadog-client.js";

export const ROLLBACK_TOOL_DEF = {
  name: "datadog_rollback",
  description: "作成したリソースを削除（ロールバック）します。confirm: true が必須。認証はDD_API_KEY/DD_APP_KEY環境変数。",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "ロールバックするセッションID（省略時は最新）",
      },
      confirm: {
        type: "boolean",
        description: "削除の確認。true でないと実行されない（安全装置）",
      },
    },
    required: ["confirm"],
  },
};

export async function rollbackTool(args: Record<string, unknown>) {
  if (args.confirm !== true) {
    return {
      content: [{ type: "text" as const, text: "ロールバックには confirm: true が必要です。リソースを削除してよいか確認してください。" }],
      isError: true,
    };
  }

  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) {
    return {
      content: [{ type: "text" as const, text: "エラー: DD_API_KEY と DD_APP_KEY 環境変数が必要です。" }],
      isError: true,
    };
  }

  const sessionId = args.session_id as string | undefined;
  const session = sessionId ? loadSession(sessionId) : loadLatestSession();

  if (!session) {
    return {
      content: [{ type: "text" as const, text: "ロールバック可能なセッションが見つかりません。" }],
      isError: true,
    };
  }

  const journal = loadJournal(session.sessionId);
  if (!journal || journal.resources.length === 0) {
    return {
      content: [{ type: "text" as const, text: `セッション ${session.sessionId} にロールバック対象のリソースはありません。` }],
    };
  }

  const site = session.site as DatadogSite;
  const client = createDatadogClient({ site, apiKey, appKey, profile: "mcp" });
  const resources = [...journal.resources].reverse();

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const details: string[] = [];

  for (const resource of resources) {
    try {
      await deleteResource(client, resource);
      details.push(`✅ 削除: [${resource.type}] ${resource.name}`);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("手動削除")) {
        details.push(`⏭️ スキップ: ${msg}`);
        skipped++;
      } else {
        details.push(`❌ 失敗: [${resource.type}] ${resource.name} — ${msg}`);
        failed++;
      }
    }
  }

  const summary = [
    `セッション: ${session.sessionId}`,
    ``,
    `削除成功: ${succeeded}件`,
    `スキップ: ${skipped}件`,
    `失敗: ${failed}件`,
    ``,
    ...details,
  ];

  return {
    content: [{ type: "text" as const, text: summary.join("\n") }],
    isError: failed > 0,
  };
}

async function deleteResource(client: DatadogClient, resource: ResourceRecord): Promise<void> {
  const { type, id, name } = resource;

  switch (type) {
    case "monitor":
      await client.v1.monitors.deleteMonitor({ monitorId: parseInt(id, 10) });
      break;
    case "dashboard":
      await client.v1.dashboards.deleteDashboard({ dashboardId: id });
      break;
    case "synthetic_test":
      await client.v1.synthetics.deleteTests({ body: { publicIds: [id] } });
      break;
    case "logs_pipeline":
      await client.v1.logsPipelines.deleteLogsPipeline({ pipelineId: id });
      break;
    case "cws_agent_policy":
      await client.security.csmThreats.deleteCSMThreatsAgentPolicy({ policyId: id });
      break;
    case "asm_waf_rule":
    case "asm_waf_custom_rule":
      await client.security.asm.deleteApplicationSecurityWafCustomRule({ customRuleId: id });
      break;
    case "asm_waf_exclusion":
    case "asm_waf_exclusion_filter":
      await client.security.asm.deleteApplicationSecurityWafExclusionFilter({ exclusionFilterId: id });
      break;
    case "security_monitoring_rule":
    case "siem_rule":
      await client.security.monitoring.deleteSecurityMonitoringRule({ ruleId: id });
      break;
    default:
      throw new Error(`[${type}] ${name} は手動削除が必要です。Datadog コンソールから削除してください。`);
  }
}
