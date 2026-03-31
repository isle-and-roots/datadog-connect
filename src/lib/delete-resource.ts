import type { ResourceRecord } from "../config/types.js";
import type { DatadogClient } from "../client/datadog-client.js";

export class SkipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipError";
  }
}

export async function deleteResource(
  client: DatadogClient,
  resource: ResourceRecord
): Promise<void> {
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

    case "cspm_aws_scan_options":
    case "cspm_gcp_scan_options":
    case "cspm_azure_scan_options":
    case "sensitive_data_group":
    case "sensitive_data_rule":
      throw new SkipError(
        `${type} (${name}) は手動削除が必要です。Datadog > Security で確認してください。`
      );

    case "aws_integration":
    case "azure_integration":
    case "service_definition":
      throw new SkipError(
        `${type} (${name}) は自動削除できません。Datadog コンソールから手動で削除してください。`
      );

    case "gcp_integration":
      throw new SkipError(
        `${type} (${name}) は手動削除が必要です。Datadog > Integrations > GCP で削除してください。`
      );

    default:
      throw new SkipError(
        `不明なリソースタイプ "${type}" (${name}) — 手動削除が必要です。`
      );
  }
}
