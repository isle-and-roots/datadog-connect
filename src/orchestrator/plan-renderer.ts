/**
 * Plan Renderer — converts an ExecutionPlan into human-readable Markdown
 * or machine-readable JSON output.
 *
 * Markdown output is structured as a runbook:
 *   - Header with session info, site, preset
 *   - Per-module sections with numbered MCP tool calls
 *   - Parameters formatted as JSON blocks
 *   - Manual steps clearly marked
 *   - Verification steps at the end
 */

import type {
  ExecutionPlan,
  ModulePlan,
  McpToolCall,
} from "./mcp-call.js";
import type { ManualStep } from "../config/types.js";

// ── Markdown Renderer ─────────────────────────────────────────────────────────

/**
 * Render an ExecutionPlan as a Markdown runbook.
 *
 * The output is designed to be read by a human operator who will
 * execute the MCP tool calls in order to set up Datadog.
 */
export function renderPlanAsMarkdown(plan: ExecutionPlan): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push("# Datadog Connect — Execution Plan");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| Session ID | \`${plan.sessionId}\` |`);
  lines.push(`| Site | \`${plan.site}\` |`);
  lines.push(`| Preset | \`${plan.preset}\` |`);
  lines.push(`| Created | ${formatDateTime(plan.createdAt)} |`);
  lines.push(`| Total MCP Calls | ${plan.totalCalls} |`);
  lines.push(`| Modules | ${plan.modules.length} |`);
  lines.push("");

  if (plan.modules.length === 0) {
    lines.push("> No modules in this plan.");
    return lines.join("\n");
  }

  lines.push("---");
  lines.push("");

  // ── Table of Contents ────────────────────────────────────────────────────────
  lines.push("## Table of Contents");
  lines.push("");
  plan.modules.forEach((mod, idx) => {
    const anchor = toAnchor(`${idx + 1}-${mod.moduleName}`);
    lines.push(`${idx + 1}. [${mod.moduleName}](#${anchor})`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Per-module sections ──────────────────────────────────────────────────────
  plan.modules.forEach((mod, moduleIdx) => {
    renderModuleSection(lines, mod, moduleIdx + 1);
    lines.push("---");
    lines.push("");
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `This plan contains **${plan.totalCalls} MCP tool call(s)** across **${plan.modules.length} module(s)**.`
  );
  lines.push("");

  const totalManual = plan.modules.reduce(
    (sum, m) => sum + m.manualSteps.length,
    0
  );
  const totalVerification = plan.modules.reduce(
    (sum, m) => sum + m.verificationCalls.length,
    0
  );

  if (totalManual > 0) {
    lines.push(
      `> **Note**: This plan includes **${totalManual} manual step(s)** that require human intervention.`
    );
    lines.push("");
  }

  if (totalVerification > 0) {
    lines.push(
      `After execution, run **${totalVerification} verification step(s)** to confirm resources were created correctly.`
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ── JSON Renderer ─────────────────────────────────────────────────────────────

/**
 * Render an ExecutionPlan as formatted JSON for programmatic consumption.
 */
export function renderPlanAsJson(plan: ExecutionPlan): string {
  return JSON.stringify(plan, null, 2);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function renderModuleSection(
  lines: string[],
  mod: ModulePlan,
  sectionNumber: number
): void {
  lines.push(`## ${sectionNumber}. ${mod.moduleName}`);
  lines.push("");
  lines.push(`**Module ID**: \`${mod.moduleId}\``);
  lines.push(`**Category**: \`${mod.category}\``);
  lines.push("");

  // MCP Tool Calls
  if (mod.calls.length === 0) {
    lines.push("_No MCP tool calls for this module._");
    lines.push("");
  } else {
    lines.push(`### MCP Tool Calls (${mod.calls.length})`);
    lines.push("");
    mod.calls.forEach((call, callIdx) => {
      renderToolCall(lines, call, callIdx + 1);
    });
  }

  // Manual Steps
  if (mod.manualSteps.length > 0) {
    lines.push(`### Manual Steps`);
    lines.push("");
    lines.push(
      "> **Manual intervention required** — perform the following steps before continuing."
    );
    lines.push("");
    mod.manualSteps.forEach((step, idx) => {
      renderManualStep(lines, step, idx + 1);
    });
  }

  // Verification Steps
  if (mod.verificationCalls.length > 0) {
    lines.push(`### Verification`);
    lines.push("");
    mod.verificationCalls.forEach((call, idx) => {
      renderVerificationCall(lines, call, idx + 1);
    });
  }
}

function renderToolCall(
  lines: string[],
  call: McpToolCall,
  callNumber: number
): void {
  const idTag = call.id ? ` \`${call.id}\`` : "";
  lines.push(`#### Step ${callNumber}: \`${call.tool}\``);
  lines.push("");
  if (call.id) {
    lines.push(`**Call ID**:${idTag}`);
    lines.push("");
  }
  lines.push(`**Description**: ${call.description}`);
  lines.push("");

  if (call.dependsOn && call.dependsOn.length > 0) {
    lines.push(`**Depends On**: ${call.dependsOn.map((d) => `\`${d}\``).join(", ")}`);
    lines.push("");
  }

  if (Object.keys(call.parameters).length > 0) {
    lines.push("**Parameters**:");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(call.parameters, null, 2));
    lines.push("```");
    lines.push("");
  } else {
    lines.push("**Parameters**: _(none)_");
    lines.push("");
  }
}

function renderManualStep(
  lines: string[],
  step: ManualStep,
  stepNumber: number
): void {
  lines.push(`#### Manual Step ${stepNumber}: ${step.title}`);
  lines.push("");
  lines.push(step.description);
  lines.push("");

  if (step.commands && step.commands.length > 0) {
    lines.push("**Commands to run**:");
    lines.push("");
    lines.push("```bash");
    step.commands.forEach((cmd) => lines.push(cmd));
    lines.push("```");
    lines.push("");
  }

  if (step.outputFile) {
    lines.push(`**Expected output file**: \`${step.outputFile}\``);
    lines.push("");
  }
}

function renderVerificationCall(
  lines: string[],
  call: McpToolCall,
  stepNumber: number
): void {
  lines.push(`#### Verify ${stepNumber}: ${call.description}`);
  lines.push("");
  lines.push(`**MCP Tool**: \`${call.tool}\``);
  lines.push("");
  if (Object.keys(call.parameters).length > 0) {
    lines.push("**Parameters**:");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(call.parameters, null, 2));
    lines.push("```");
    lines.push("");
  }
}

/**
 * Format an ISO date string for human-readable display (UTC).
 */
function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toUTCString();
  } catch {
    return iso;
  }
}

/**
 * Convert a section title to a GitHub-flavored Markdown anchor.
 * e.g. "1-AWS Integration" → "1-aws-integration"
 */
function toAnchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
