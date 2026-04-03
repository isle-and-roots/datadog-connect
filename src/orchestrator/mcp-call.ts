/**
 * MCP Tool Call types for the Datadog Connect harness.
 *
 * Defines the structures used when generating MCP tool invocation plans
 * instead of calling the Datadog API directly.
 */

import type { ManualStep } from "../config/types.js";

// ── MCP Tool Call ─────────────────────────────────────────────────────────────

/**
 * A single MCP tool invocation with all parameters needed to execute it.
 */
export interface McpToolCall {
  /** The MCP tool name to invoke (e.g. "datadog_create_monitor") */
  tool: string;
  /** Parameters to pass to the tool */
  parameters: Record<string, unknown>;
  /** Human-readable description of what this call does */
  description: string;
  /** IDs of McpToolCall steps this call depends on */
  dependsOn?: string[];
  /** A companion call to undo this action on rollback */
  rollbackCall?: Omit<McpToolCall, "rollbackCall">;
  /** Unique identifier for this call within the plan */
  id?: string;
}

// ── Module Plan ───────────────────────────────────────────────────────────────

/**
 * The plan produced by a single module's plan() method.
 * Contains the ordered list of MCP tool calls needed to set up this module.
 */
export interface ModulePlan {
  /** Module ID that produced this plan */
  moduleId: string;
  /** Human-readable module name */
  moduleName: string;
  /** Module category */
  category: "cloud" | "feature" | "security";
  /** Ordered list of MCP tool calls to execute */
  calls: McpToolCall[];
  /** Manual steps that must be performed outside the MCP harness */
  manualSteps: ManualStep[];
  /** Steps to verify the module was set up correctly */
  verificationCalls: McpToolCall[];
}

// ── Execution Plan ────────────────────────────────────────────────────────────

/**
 * The complete execution plan for a preset, containing ordered module plans.
 */
export interface ExecutionPlan {
  /** Unique session identifier */
  sessionId: string;
  /** Datadog site (e.g. "datadoghq.com") */
  site: string;
  /** Preset that was used to generate this plan */
  preset: string;
  /** Ordered module plans (dependencies resolved) */
  modules: ModulePlan[];
  /** Total count of MCP tool calls across all modules */
  totalCalls: number;
  /** ISO timestamp when the plan was created */
  createdAt: string;
}
