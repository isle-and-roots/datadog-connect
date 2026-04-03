/**
 * Plan Builder — constructs an ExecutionPlan from a preset name and optional
 * per-module configurations.
 *
 * This module bridges the knowledge layer (presets.ts) and the module registry
 * (registry.ts) to produce a fully resolved, dependency-sorted plan.
 *
 * Note: Individual modules must implement plan() (Task #12) before this
 * function can produce non-empty module plans at runtime.  The structure is
 * correct and will compile without any module implementing plan() yet.
 */

import { randomUUID } from "node:crypto";
import {
  resolvePresetModuleIds,
  getDefaultModuleConfig,
} from "../knowledge/presets.js";
import type { PresetId } from "../knowledge/presets.js";
import { getModules, resolveOrder } from "../modules/registry.js";
import type { ExecutionPlan, ModulePlan } from "./mcp-call.js";
import type { ModuleConfig } from "../config/types.js";

// ── Public API ────────────────────────────────────────────────────────────────

export interface BuildPlanOptions {
  /** Preset identifier (e.g. "recommended", "aws", "security") */
  preset: string;
  /**
   * Optional per-module configuration overrides.
   * Keys are module IDs; values are merged over the module defaults.
   */
  moduleConfigs?: Record<string, Record<string, unknown>>;
  /** Datadog site (defaults to "datadoghq.com") */
  site?: string;
  /** Session ID — auto-generated UUID if omitted */
  sessionId?: string;
}

/**
 * Build a complete, dependency-sorted ExecutionPlan for the given preset.
 *
 * Steps:
 *  1. Resolve preset → ordered module ID list
 *  2. Filter registered modules to those in the list
 *  3. topological sort via resolveOrder()
 *  4. Merge per-module configs with defaults
 *  5. Call each module's plan(config) method
 *  6. Assemble into an ExecutionPlan
 *
 * @throws {Error} if the preset is unknown, "custom" (requires caller to
 *   supply moduleIds), or if dependencies cannot be resolved.
 */
export function buildExecutionPlan(options: BuildPlanOptions): ExecutionPlan {
  const {
    preset,
    moduleConfigs = {},
    site = "datadoghq.com",
    sessionId = randomUUID(),
  } = options;

  // Step 1: Resolve preset → module IDs
  const resolvedIds = resolvePresetModuleIds(preset as PresetId);
  if (resolvedIds === null) {
    throw new Error(
      `Preset "${preset}" is a custom preset — provide explicit module IDs instead.`
    );
  }

  // Step 2: Filter registered modules to the preset selection
  const allModules = getModules();
  const selectedModules = resolvedIds
    .map((id) => allModules.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  if (selectedModules.length === 0) {
    throw new Error(
      `No registered modules found for preset "${preset}". ` +
        `Expected module IDs: ${resolvedIds.join(", ")}`
    );
  }

  // Step 3: Topological sort (also validates hard dependencies)
  const sortedModules = resolveOrder(selectedModules);

  // Step 4 & 5: Build per-module plans
  const modulePlans: ModulePlan[] = sortedModules.map((mod) => {
    const defaults = getDefaultModuleConfig(mod.id);
    const overrides = moduleConfigs[mod.id] ?? {};
    const config: ModuleConfig = { ...defaults, ...overrides };

    return mod.plan(config);
  });

  // Step 6: Assemble ExecutionPlan
  const totalCalls = modulePlans.reduce(
    (sum, mp) => sum + mp.calls.length,
    0
  );

  const plan: ExecutionPlan = {
    sessionId,
    site,
    preset,
    createdAt: new Date().toISOString(),
    modules: modulePlans,
    totalCalls,
  };

  return plan;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a plan from an explicit list of module IDs instead of a preset.
 * Useful for "custom" preset mode where the caller collects module IDs.
 */
export function buildExecutionPlanFromIds(options: {
  moduleIds: string[];
  moduleConfigs?: Record<string, Record<string, unknown>>;
  site?: string;
  sessionId?: string;
}): ExecutionPlan {
  const {
    moduleIds,
    moduleConfigs = {},
    site = "datadoghq.com",
    sessionId = randomUUID(),
  } = options;

  const allModules = getModules();
  const selectedModules = moduleIds
    .map((id) => allModules.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  if (selectedModules.length === 0) {
    throw new Error(
      `No registered modules found for IDs: ${moduleIds.join(", ")}`
    );
  }

  const sortedModules = resolveOrder(selectedModules);

  const modulePlans: ModulePlan[] = sortedModules.map((mod) => {
    const defaults = getDefaultModuleConfig(mod.id);
    const overrides = moduleConfigs[mod.id] ?? {};
    const config: ModuleConfig = { ...defaults, ...overrides };

    return mod.plan(config);
  });

  const totalCalls = modulePlans.reduce(
    (sum, mp) => sum + mp.calls.length,
    0
  );

  return {
    sessionId,
    site,
    preset: "custom",
    createdAt: new Date().toISOString(),
    modules: modulePlans,
    totalCalls,
  };
}
