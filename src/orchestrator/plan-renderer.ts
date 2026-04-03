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

import chalk from "chalk";
import type {
  ExecutionPlan,
  ModulePlan,
  McpToolCall,
} from "./mcp-call.js";
import type { ManualStep } from "../config/types.js";
import { MODULE_CONSOLE_URLS } from "../config/constants.js";

// ── Markdown Renderer ─────────────────────────────────────────────────────────

/**
 * Render an ExecutionPlan as a Markdown runbook.
 *
 * The output is designed to be read by a human operator who will
 * execute the MCP tool calls in order to set up Datadog.
 */
export function renderPlanAsMarkdown(plan: ExecutionPlan): string {
  const lines: string[] = [];

  // ── Compute total step count (auto calls + manual steps across all modules) ──
  const totalSteps = plan.modules.reduce(
    (sum, m) => sum + m.calls.length + m.manualSteps.length,
    0
  );

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
  lines.push(`| Total Steps | ${totalSteps} |`);
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
  let globalStep = 0;
  plan.modules.forEach((mod, moduleIdx) => {
    globalStep = renderModuleSection(lines, mod, moduleIdx + 1, globalStep, totalSteps);
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
  sectionNumber: number,
  globalStep: number,
  totalSteps: number
): number {
  lines.push(`## ${sectionNumber}. ${mod.moduleName}`);
  lines.push("");
  lines.push(`**Module ID**: \`${mod.moduleId}\``);
  lines.push(`**Category**: \`${mod.category}\``);
  lines.push("");

  // MCP Tool Calls (AUTO)
  if (mod.calls.length === 0 && mod.manualSteps.length === 0) {
    lines.push("_No steps for this module._");
    lines.push("");
  } else {
    if (mod.calls.length > 0) {
      lines.push(`### MCP Tool Calls (${mod.calls.length})`);
      lines.push("");
      mod.calls.forEach((call) => {
        globalStep += 1;
        renderToolCall(lines, call, globalStep, totalSteps);
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
      mod.manualSteps.forEach((step) => {
        globalStep += 1;
        renderManualStep(lines, step, globalStep, totalSteps);
      });
    }
  }

  // Verification Steps
  if (mod.verificationCalls.length > 0) {
    lines.push(`### Verification`);
    lines.push("");
    mod.verificationCalls.forEach((call, idx) => {
      renderVerificationCall(lines, call, idx + 1);
    });
  }

  return globalStep;
}

function renderToolCall(
  lines: string[],
  call: McpToolCall,
  globalStep: number,
  totalSteps: number
): void {
  const idTag = call.id ? ` \`${call.id}\`` : "";
  lines.push(`#### Step ${globalStep} of ${totalSteps} [AUTO]: \`${call.tool}\``);
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
  globalStep: number,
  totalSteps: number
): void {
  lines.push(`#### Step ${globalStep} of ${totalSteps} [MANUAL]: ${step.title}`);
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
  if (call.expectedOutput) {
    lines.push(`**期待結果**: ${call.expectedOutput}`);
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

// ── Post-Setup Summary ────────────────────────────────────────────────────────

/**
 * Render a post-setup verification summary with Datadog console links.
 *
 * Shows a table of modules with their call counts and direct links to the
 * relevant Datadog console pages, plus resume/rollback commands for reference.
 */
export function renderPostSetupSummary(plan: ExecutionPlan): string {
  const consoleBase = "https://app.datadoghq.com";
  const lines: string[] = [];

  lines.push(chalk.bold.cyan("\n  セットアップサマリー"));
  lines.push(chalk.dim("  " + "─".repeat(50)));
  lines.push("");

  // Module table
  lines.push(
    `  ${chalk.bold("モジュール".padEnd(20))}  ${chalk.bold("呼び出し数".padEnd(10))}  ${chalk.bold("コンソールURL")}`
  );
  lines.push(chalk.dim("  " + "─".repeat(70)));

  for (const mod of plan.modules) {
    const consolePath = MODULE_CONSOLE_URLS[mod.moduleId];
    const url = consolePath ? chalk.cyan(`${consoleBase}${consolePath}`) : chalk.dim("—");
    const callCount = String(mod.calls.length).padEnd(10);
    const modName = mod.moduleName.padEnd(20);
    lines.push(`  ${modName}  ${callCount}  ${url}`);
  }

  lines.push("");
  lines.push(chalk.dim("  " + "─".repeat(50)));

  // Totals
  lines.push(
    `  合計: ${chalk.bold(String(plan.modules.length))} モジュール / ` +
      `${chalk.bold(String(plan.totalCalls))} MCP 呼び出し`
  );

  lines.push("");

  // Next steps
  lines.push(chalk.bold("  次のステップ"));
  lines.push(chalk.dim("  ─────────────"));
  lines.push(
    `  1. 上記ランブックの MCP ツール呼び出しを順番に実行してください`
  );
  lines.push(
    `  2. Datadog MCP 未設定の場合: ${chalk.cyan("datadog-connect mcp")}`
  );
  lines.push(
    `  3. 途中から再開する場合:     ${chalk.cyan(`datadog-connect resume --session ${plan.sessionId}`)}`
  );
  lines.push(
    `  4. ロールバックする場合:     ${chalk.cyan(`datadog-connect rollback --session ${plan.sessionId}`)}`
  );
  lines.push("");

  return lines.join("\n");
}
