// ── Datadog Sites ──
export type DatadogSite =
  | "datadoghq.com"
  | "datadoghq.eu"
  | "us3.datadoghq.com"
  | "us5.datadoghq.com"
  | "ap1.datadoghq.com"
  | "ddog-gov.com";

// ── Auth ──
export interface Credentials {
  site: DatadogSite;
  apiKey: string;
  appKey: string;
  profile: string;
}

// ── Module System ──
export type ModuleCategory = "cloud" | "feature" | "security";
export type ApplyMode = "dry-run" | "monitor" | "enforce";

export interface PreflightResult {
  available: boolean;
  reason?: string;
}
export type ModuleState =
  | "pending"
  | "prompted"
  | "executing"
  | "completed"
  | "failed"
  | "skipped";

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  dependencies: string[];
}

export interface ModuleConfig {
  [key: string]: unknown;
}

export interface ResourceRecord {
  type: string; // e.g. "monitor", "dashboard", "aws_integration"
  id: string;
  name: string;
  createdAt: string;
}

export interface ManualStep {
  title: string;
  description: string;
  commands?: string[];
  outputFile?: string;
}

export interface ExecutionResult {
  success: boolean;
  resources: ResourceRecord[];
  manualSteps: ManualStep[];
  errors: string[];
}

export interface VerificationResult {
  success: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

// ── State Management ──
export interface SessionState {
  sessionId: string;
  site: DatadogSite;
  profile: string;
  startedAt: string;
  modules: Record<
    string,
    {
      state: ModuleState;
      config?: ModuleConfig;
      resources: ResourceRecord[];
      errors: string[];
    }
  >;
}

// ── Template System ──
export interface ParameterDef {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description: string;
}

export interface MonitorTemplate {
  id: string;
  name: string;
  version: string;
  category:
    | "infra"
    | "aws"
    | "gcp"
    | "azure"
    | "k8s"
    | "apm"
    | "logs"
    | "cost";
  parameters: ParameterDef[];
  definition: Record<string, unknown>;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  version: string;
  parameters: ParameterDef[];
  definition: Record<string, unknown>;
}
