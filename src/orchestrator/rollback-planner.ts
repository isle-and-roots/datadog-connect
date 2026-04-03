/**
 * Rollback Planner — builds a list of MCP tool calls to delete resources
 * that were previously created during a session.
 *
 * Resources are deleted in REVERSE creation order to respect dependencies
 * (e.g. a dashboard that references a monitor should be deleted before the
 * monitor itself).
 *
 * Resource type → MCP delete tool mapping follows the Datadog MCP server
 * tool naming convention: datadog_delete_<resource_type>.
 */

import { randomUUID } from "node:crypto";
import type { ResourceRecord } from "../config/types.js";
import type { McpToolCall } from "./mcp-call.js";

// ── Resource Type → MCP Tool Mapping ─────────────────────────────────────────

/**
 * Maps a ResourceRecord.type to the corresponding Datadog MCP delete tool
 * name and the parameter key used to pass the resource ID.
 */
interface DeleteToolMapping {
  /** MCP tool name */
  tool: string;
  /** Parameter key for the resource ID (e.g. "monitor_id", "dashboard_id") */
  idParam: string;
}

const RESOURCE_DELETE_MAP: Record<string, DeleteToolMapping> = {
  monitor: {
    tool: "datadog_delete_monitor",
    idParam: "monitor_id",
  },
  dashboard: {
    tool: "datadog_delete_dashboard",
    idParam: "dashboard_id",
  },
  synthetics_test: {
    tool: "datadog_delete_synthetics_tests",
    idParam: "public_id",
  },
  synthetics: {
    tool: "datadog_delete_synthetics_tests",
    idParam: "public_id",
  },
  aws_integration: {
    tool: "datadog_delete_aws_account",
    idParam: "account_id",
  },
  gcp_integration: {
    tool: "datadog_delete_gcp_integration",
    idParam: "project_id",
  },
  azure_integration: {
    tool: "datadog_delete_azure_integration",
    idParam: "tenant_name",
  },
  log_pipeline: {
    tool: "datadog_delete_logs_pipeline",
    idParam: "pipeline_id",
  },
  log_index: {
    tool: "datadog_delete_logs_index",
    idParam: "name",
  },
  metric_tag_configuration: {
    tool: "datadog_delete_tag_configuration",
    idParam: "metric_name",
  },
  slo: {
    tool: "datadog_delete_slo",
    idParam: "slo_id",
  },
  downtime: {
    tool: "datadog_cancel_downtime",
    idParam: "downtime_id",
  },
  notebook: {
    tool: "datadog_delete_notebook",
    idParam: "notebook_id",
  },
  security_rule: {
    tool: "datadog_delete_security_monitoring_rule",
    idParam: "rule_id",
  },
  security_signal: {
    tool: "datadog_mute_findings",
    idParam: "finding_id",
  },
  sensitive_data_scanner_group: {
    tool: "datadog_delete_scanning_group",
    idParam: "group_id",
  },
  sensitive_data_scanner_rule: {
    tool: "datadog_delete_scanning_rule",
    idParam: "rule_id",
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a list of MCP tool calls that will delete the given resources.
 *
 * Resources are processed in REVERSE order of the input list so that
 * resources created later (which may depend on earlier ones) are removed first.
 *
 * Resources whose type has no known delete tool are included as a
 * "datadog_delete_unknown_resource" stub call so the caller can see that
 * manual deletion may be required.
 *
 * @param resources - Array of ResourceRecord entries from the operation journal
 * @returns Ordered list of McpToolCall entries to execute for rollback
 */
export function buildRollbackPlan(resources: ResourceRecord[]): McpToolCall[] {
  if (resources.length === 0) {
    return [];
  }

  // Reverse to delete in opposite order of creation
  const reversed = [...resources].reverse();

  return reversed.map((resource) => buildDeleteCall(resource));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildDeleteCall(resource: ResourceRecord): McpToolCall {
  const mapping = RESOURCE_DELETE_MAP[resource.type.toLowerCase()];

  if (mapping) {
    return {
      id: randomUUID(),
      tool: mapping.tool,
      parameters: {
        [mapping.idParam]: resource.id,
      },
      description: `Delete ${resource.type} "${resource.name}" (ID: ${resource.id}) created at ${resource.createdAt}`,
    };
  }

  // Fallback for unknown resource types — still emit a call so the caller
  // knows manual intervention is needed.
  return {
    id: randomUUID(),
    tool: "datadog_delete_unknown_resource",
    parameters: {
      resource_type: resource.type,
      resource_id: resource.id,
      resource_name: resource.name,
    },
    description: `[MANUAL] Delete ${resource.type} "${resource.name}" (ID: ${resource.id}) — no automated delete tool available`,
  };
}
