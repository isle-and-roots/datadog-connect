/**
 * Preset Definitions — single source of truth for all Datadog Connect preset configurations.
 *
 * Extracted from wizard.ts and setup-tool.ts.  Pure TypeScript objects with no
 * runtime dependencies on @datadog/datadog-api-client or DatadogClient.
 * Used by both the interactive wizard and the MCP Harness tools.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** All supported preset identifiers. */
export type PresetId =
  | "minimal"
  | "recommended"
  | "aws"
  | "gcp"
  | "azure"
  | "security"
  | "xserver"
  | "full"
  | "custom";

/** Module category, mirroring ModuleCategory from config/types.ts. */
export type ModuleCategory = "cloud" | "feature" | "security";

/** Human-readable preset metadata shown in the wizard selection prompt. */
export interface PresetMeta {
  /** Unique identifier matching PresetId. */
  id: PresetId;
  /** Short display label used in select prompts. */
  label: string;
  /** Longer description shown alongside the label. */
  description: string;
  /** Whether this preset lets the user choose modules individually. */
  isCustom: boolean;
}

/** Mapping of a preset to the ordered list of module IDs it includes. */
export interface PresetModuleMap {
  preset: PresetId;
  /** Module IDs in the order they should appear / be applied. */
  moduleIds: string[];
}

/** Default per-module configuration values used when no user input is provided (MCP mode). */
export type DefaultModuleConfig = Record<string, Record<string, unknown>>;

// ── All Module IDs ──────────────────────────────────────────────────────────

/**
 * Complete list of all 16 module IDs registered by the tool.
 * Used by the "full" preset and the custom selection screen.
 */
export const ALL_MODULE_IDS: string[] = [
  // cloud
  "aws",
  "gcp",
  "azure",
  "on-prem",
  "kubernetes",
  "xserver",
  // feature
  "apm",
  "logs",
  "dashboards",
  "monitors",
  "synthetics",
  // security
  "cspm",
  "cws",
  "asm",
  "siem",
  "sensitive-data",
];

// ── Preset Metadata ─────────────────────────────────────────────────────────

/**
 * Ordered list of preset options presented to the user in the wizard.
 * Maps directly to the `choices` array in wizard.ts `select()` call.
 */
export const PRESET_META: PresetMeta[] = [
  {
    id: "minimal",
    label: "クイックスタート",
    description: "モニター + ダッシュボード（5分で完了）",
    isCustom: false,
  },
  {
    id: "recommended",
    label: "おすすめセット",
    description: "ダッシュボード + モニター + ログ（まず試したい方に）",
    isCustom: false,
  },
  {
    id: "aws",
    label: "AWS環境向け",
    description: "AWS統合 + モニター + ダッシュボード + APM",
    isCustom: false,
  },
  {
    id: "gcp",
    label: "GCP環境向け",
    description: "GCP統合 + モニター + ダッシュボード + APM",
    isCustom: false,
  },
  {
    id: "azure",
    label: "Azure環境向け",
    description: "Azure インテグレーション + 基本モニタリング",
    isCustom: false,
  },
  {
    id: "security",
    label: "セキュリティ重視",
    description: "CSPM + CWS + ASM + SIEM + SDS (+ APM/Logs依存)",
    isCustom: false,
  },
  {
    id: "xserver",
    label: "Xserver向け",
    description: "Xserver + モニター + ダッシュボード",
    isCustom: false,
  },
  {
    id: "full",
    label: "フル",
    description: "全16モジュール",
    isCustom: false,
  },
  {
    id: "custom",
    label: "カスタム",
    description: "個別に選択",
    isCustom: true,
  },
];

// ── Preset → Module Mapping ─────────────────────────────────────────────────

/**
 * Maps each non-custom preset to the ordered list of module IDs it enables.
 * "full" expands to ALL_MODULE_IDS at runtime.
 *
 * This is the canonical definition; wizard.ts and setup-tool.ts both derive
 * their PRESETS record from here.
 */
export const PRESET_MODULE_MAP: Record<Exclude<PresetId, "custom" | "full">, string[]> = {
  minimal: ["monitors", "dashboards"],
  recommended: ["dashboards", "monitors", "logs"],
  aws: ["aws", "dashboards", "monitors", "apm", "logs"],
  gcp: ["gcp", "dashboards", "monitors", "apm", "logs"],
  azure: ["azure", "dashboards", "monitors", "apm", "logs"],
  security: ["apm", "logs", "cspm", "cws", "asm", "siem", "sensitive-data"],
  xserver: ["xserver", "dashboards", "monitors"],
};

/**
 * Resolve a preset ID to a concrete list of module IDs.
 * Returns null for "custom" (caller must collect user selection).
 */
export function resolvePresetModuleIds(preset: PresetId): string[] | null {
  if (preset === "custom") return null;
  if (preset === "full") return [...ALL_MODULE_IDS];
  return [...PRESET_MODULE_MAP[preset]];
}

// ── Default Module Configs (MCP / headless mode) ────────────────────────────

/**
 * Minimal default configurations for each module.
 * Used in MCP / headless mode when no user-provided module_configs are given.
 * Mirrors the getDefaultConfig() function in setup-tool.ts.
 */
export const DEFAULT_MODULE_CONFIGS: DefaultModuleConfig = {
  dashboards: { presets: ["infra-overview"], tags: [] },
  monitors: { packs: ["infra"], useDefaults: true, notificationHandle: "", tags: [] },
  logs: { sources: ["nginx"], tags: [] },
  apm: { services: [], languages: [], tags: [] },
  synthetics: { endpoints: [], tags: [] },
  cspm: { clouds: [], tags: [] },
  cws: { tags: [] },
  asm: { enableWaf: true, tags: [] },
  siem: { packs: ["auth"], tags: [] },
  "sensitive-data": { patterns: ["PII"], tags: [] },
  aws: { tags: [] },
  gcp: { tags: [] },
  azure: { tags: [] },
  "on-prem": { tags: [] },
  kubernetes: { tags: [] },
  xserver: { tags: [] },
};

/**
 * Return the default config for a given module ID.
 * Falls back to `{ tags: [] }` for unknown modules.
 */
export function getDefaultModuleConfig(moduleId: string): Record<string, unknown> {
  return DEFAULT_MODULE_CONFIGS[moduleId] ?? { tags: [] };
}

// ── Category Grouping ────────────────────────────────────────────────────────

/** Module IDs grouped by category, used by the custom selection wizard. */
export const MODULES_BY_CATEGORY: Record<ModuleCategory, string[]> = {
  cloud: ["aws", "gcp", "azure", "on-prem", "kubernetes", "xserver"],
  feature: ["apm", "logs", "dashboards", "monitors", "synthetics"],
  security: ["cspm", "cws", "asm", "siem", "sensitive-data"],
};

/**
 * Default checked state per module in the custom wizard's feature/security step.
 * Cloud modules are never pre-checked; feature modules "monitors" and "dashboards" are.
 */
export const CUSTOM_WIZARD_DEFAULTS: Record<string, boolean> = {
  monitors: true,
  dashboards: true,
};
