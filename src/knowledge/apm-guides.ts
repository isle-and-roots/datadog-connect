/**
 * APM Instrumentation Guides, Log Pipeline Definitions, and Synthetic Test Templates.
 *
 * All data is extracted from:
 *   - src/modules/features/apm.module.ts  (language guides, service catalog definitions)
 *   - src/modules/features/logs.module.ts  (pipeline definitions, retention options)
 *   - src/modules/features/synthetics.module.ts  (test templates, locations, frequencies)
 *
 * No imports from @datadog/datadog-api-client or DatadogClient — pure data exports only.
 */

// ═══════════════════════════════════════════════════════════════════════════
// ── APM: Language Definitions ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** Supported APM instrumentation languages. */
export type ApmLanguage =
  | "nodejs"
  | "python"
  | "java"
  | "go"
  | "ruby"
  | "dotnet"
  | "php";

/** Human-readable language label used in wizard prompts. */
export interface LanguageMeta {
  value: ApmLanguage;
  name: string;
}

/**
 * Ordered list of languages shown in the APM module checkbox prompt.
 * Order matches the original LANGUAGES array in apm.module.ts.
 */
export const APM_LANGUAGES: LanguageMeta[] = [
  { value: "java", name: "Java" },
  { value: "python", name: "Python" },
  { value: "nodejs", name: "Node.js" },
  { value: "go", name: "Go" },
  { value: "ruby", name: "Ruby" },
  { value: "dotnet", name: ".NET" },
  { value: "php", name: "PHP" },
];

// ── APM: Instrumentation Snippets ─────────────────────────────────────────

/** Parameters used when rendering an instrumentation guide. */
export interface InstrumentationParams {
  environment: string;
  enableProfiling?: boolean;
  enableDataStreams?: boolean;
}

/**
 * Per-language install command and package information.
 * Used by knowledge tools to answer "how do I install the tracer?" queries.
 */
export interface TracerPackage {
  language: ApmLanguage;
  /** Package manager command(s) to install the tracer library. */
  installCommands: string[];
  /** Canonical package / artifact name. */
  packageName: string;
  /** Approximate current stable version at time of authoring. */
  stableVersion?: string;
}

/** dd-trace package install information per language. */
export const TRACER_PACKAGES: TracerPackage[] = [
  {
    language: "nodejs",
    packageName: "dd-trace",
    installCommands: ["npm install dd-trace"],
    stableVersion: "5.x",
  },
  {
    language: "python",
    packageName: "ddtrace",
    installCommands: ["pip install ddtrace"],
    stableVersion: "2.x",
  },
  {
    language: "java",
    packageName: "dd-java-agent",
    installCommands: ["curl -Lo dd-java-agent.jar https://dtdg.co/latest-java-tracer"],
    stableVersion: "1.x",
  },
  {
    language: "go",
    packageName: "gopkg.in/DataDog/dd-trace-go.v1",
    installCommands: ["go get gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"],
    stableVersion: "1.x",
  },
  {
    language: "ruby",
    packageName: "datadog",
    installCommands: ["# Add to Gemfile:", "gem 'datadog', require: 'datadog/auto_instrument'"],
    stableVersion: "2.x",
  },
  {
    language: "dotnet",
    packageName: "Datadog.Trace.Bundle",
    installCommands: ["dotnet add package Datadog.Trace.Bundle"],
    stableVersion: "2.x",
  },
  {
    language: "php",
    packageName: "datadog_trace",
    installCommands: [
      "pecl install datadog_trace",
      'echo "extension=ddtrace.so" >> php.ini',
    ],
    stableVersion: "0.x",
  },
];

/**
 * Generate a Markdown instrumentation guide for a single language.
 * Mirrors the generateInstrumentationGuide() function in apm.module.ts.
 *
 * The SERVICE_NAME placeholder must be replaced by the caller.
 */
export function generateInstrumentationGuide(
  lang: ApmLanguage,
  params: InstrumentationParams
): string {
  const { environment, enableProfiling = false } = params;

  const guides: Record<ApmLanguage, string> = {
    nodejs: `# Node.js APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
npm install dd-trace
\`\`\`

## 2. アプリケーション起動時に初期化
\`\`\`javascript
// app.js の先頭に追加
require('dd-trace').init({
  service: '<SERVICE_NAME>',
  env: '${environment}',
  version: '1.0.0',
  ${enableProfiling ? "profiling: true," : ""}
  runtimeMetrics: true,
});
\`\`\`

## 3. 環境変数
\`\`\`bash
DD_AGENT_HOST=localhost
DD_TRACE_AGENT_PORT=8126
DD_ENV=${environment}
\`\`\`
`,

    python: `# Python APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
pip install ddtrace
\`\`\`

## 2. アプリケーション起動
\`\`\`bash
ddtrace-run python app.py
# または
DD_SERVICE=<SERVICE_NAME> DD_ENV=${environment} ddtrace-run gunicorn app:app
\`\`\`

## 3. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${environment}
${enableProfiling ? "DD_PROFILING_ENABLED=true" : ""}
\`\`\`
`,

    java: `# Java APM 計装ガイド
## 1. Agent ダウンロード
\`\`\`bash
curl -Lo dd-java-agent.jar https://dtdg.co/latest-java-tracer
\`\`\`

## 2. JVMオプション追加
\`\`\`bash
java -javaagent:dd-java-agent.jar \\
  -Ddd.service=<SERVICE_NAME> \\
  -Ddd.env=${environment} \\
  ${enableProfiling ? "-Ddd.profiling.enabled=true \\\n  " : ""}-jar app.jar
\`\`\`
`,

    go: `# Go APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
go get gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer
\`\`\`

## 2. コードに追加
\`\`\`go
import "gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"

func main() {
    tracer.Start(
        tracer.WithService("<SERVICE_NAME>"),
        tracer.WithEnv("${environment}"),
    )
    defer tracer.Stop()
}
\`\`\`
`,

    ruby: `# Ruby APM 計装ガイド
## 1. Gemfileに追加
\`\`\`ruby
gem 'datadog', require: 'datadog/auto_instrument'
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${environment}
\`\`\`
`,

    dotnet: `# .NET APM 計装ガイド
## 1. NuGetパッケージ追加
\`\`\`bash
dotnet add package Datadog.Trace.Bundle
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${environment}
CORECLR_ENABLE_PROFILING=1
CORECLR_PROFILER={846F5F1C-F9AE-4B07-969E-05C26BC060D8}
\`\`\`
`,

    php: `# PHP APM 計装ガイド
## 1. 拡張インストール
\`\`\`bash
# pecl
pecl install datadog_trace
echo "extension=ddtrace.so" >> php.ini
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${environment}
\`\`\`
`,
  };

  return (
    guides[lang] ??
    `# ${lang} APM 計装ガイド\nSee: https://docs.datadoghq.com/tracing/trace_collection/\n`
  );
}

// ── APM: Service Catalog Definitions ──────────────────────────────────────

/** Service tier classification used in the Datadog Service Catalog. */
export type ServiceTier = "Tier 1" | "Tier 2" | "Tier 3";

/** Service lifecycle state used in the Datadog Service Catalog. */
export type ServiceLifecycle = "production" | "staging" | "development" | "deprecated";

/** Minimal service definition submitted to the Datadog Service Catalog. */
export interface ServiceCatalogEntry {
  schemaVersion: "v2.1";
  ddService: string;
  team: string;
  description: string;
  tier: ServiceTier;
  languages: string[];
  type: string;
  lifecycle: ServiceLifecycle;
}

/**
 * Build a ServiceCatalogEntry for a given service name and language.
 * The description is prefixed with the RESOURCE_PREFIX tag.
 */
export function buildServiceCatalogEntry(
  serviceName: string,
  language: string,
  resourcePrefix: string
): ServiceCatalogEntry {
  return {
    schemaVersion: "v2.1",
    ddService: serviceName,
    team: "default",
    description: `${resourcePrefix} ${serviceName}`,
    tier: "Tier 1",
    languages: [language],
    type: "web",
    lifecycle: "production",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Logs: Pipeline Definitions ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** Log source identifier. */
export type LogSource =
  | "application"
  | "nginx"
  | "apache"
  | "docker"
  | "syslog"
  | "json"
  | "custom";

/** Human-readable log source label. */
export interface LogSourceMeta {
  value: LogSource;
  name: string;
}

/** Log source options shown in the logs module checkbox. */
export const LOG_SOURCES: LogSourceMeta[] = [
  { value: "application", name: "アプリケーションログ" },
  { value: "nginx", name: "Nginx" },
  { value: "apache", name: "Apache" },
  { value: "docker", name: "Docker / コンテナ" },
  { value: "syslog", name: "Syslog" },
  { value: "json", name: "JSON形式ログ" },
  { value: "custom", name: "カスタム形式" },
];

/** A single log processor definition (Datadog pipeline processor). */
export type LogProcessorDef = Record<string, unknown>;

/** Full definition of a log pipeline for one source. */
export interface LogPipelineDef {
  /** Human-readable pipeline name (will be prefixed with RESOURCE_PREFIX). */
  name: string;
  /** Datadog log filter query used to match incoming logs to this pipeline. */
  filterQuery: string;
  /** Ordered list of log processors to apply. */
  processors: LogProcessorDef[];
}

/**
 * Log pipeline definitions extracted from logs.module.ts getPipelineDefinition().
 * Keys are LogSource values; "docker" and "custom" have no managed pipeline.
 */
export const LOG_PIPELINE_DEFS: Partial<Record<LogSource, LogPipelineDef>> = {
  nginx: {
    name: "Nginx Access Logs",
    filterQuery: "source:nginx",
    processors: [
      {
        type: "grok-parser",
        name: "Nginx Access Log Parser",
        isEnabled: true,
        source: "message",
        samples: [],
        grok: {
          matchRules:
            'access.common %{_client_ip} %{_ident} %{_auth} \\[%{_date_access}\\] "(?>%{_method} |)%{_url}(?> %{_version}|)" %{_status_code} (?>%{_bytes_written}|-)',
          supportRules: "",
        },
      },
      {
        type: "status-remapper",
        name: "Status Remapper",
        isEnabled: true,
        sources: ["http.status_code"],
      },
    ],
  },

  apache: {
    name: "Apache Access Logs",
    filterQuery: "source:apache",
    processors: [
      {
        type: "grok-parser",
        name: "Apache Access Log Parser",
        isEnabled: true,
        source: "message",
        samples: [],
        grok: {
          matchRules:
            'access.common %{_client_ip} %{_ident} %{_auth} \\[%{_date_access}\\] "(?>%{_method} |)%{_url}(?> %{_version}|)" %{_status_code} (?>%{_bytes_written}|-)',
          supportRules: "",
        },
      },
    ],
  },

  json: {
    name: "JSON Application Logs",
    filterQuery: "source:application @type:json",
    processors: [
      {
        type: "attribute-remapper",
        name: "Level Remapper",
        isEnabled: true,
        sources: ["level", "severity", "log_level"],
        target: "status",
        preserveSource: true,
        overrideOnConflict: false,
        sourceType: "attribute",
        targetType: "attribute",
      },
      {
        type: "date-remapper",
        name: "Date Remapper",
        isEnabled: true,
        sources: ["timestamp", "date", "time", "@timestamp"],
      },
    ],
  },

  syslog: {
    name: "Syslog",
    filterQuery: "source:syslog",
    processors: [
      {
        type: "grok-parser",
        name: "Syslog Parser",
        isEnabled: true,
        source: "message",
        samples: [],
        grok: {
          matchRules:
            'syslog %{date("MMM dd HH:mm:ss"):date} %{word:host} %{word:program}(\\[%{number:pid}\\])?: %{data:message}',
          supportRules: "",
        },
      },
    ],
  },

  application: {
    name: "Application Logs",
    filterQuery: "source:application",
    processors: [
      {
        type: "status-remapper",
        name: "Status Remapper",
        isEnabled: true,
        sources: ["level", "severity", "status"],
      },
    ],
  },
};

/**
 * Return the pipeline definition for a given log source, or null if no managed
 * pipeline exists for that source.
 */
export function getLogPipelineDef(source: LogSource): LogPipelineDef | null {
  return LOG_PIPELINE_DEFS[source] ?? null;
}

// ── Logs: Retention Options ────────────────────────────────────────────────

/** Log index retention period option. */
export interface RetentionOption {
  value: number;
  name: string;
}

/**
 * Retention period options shown in the logs module select prompt.
 * The default selection is 15 days.
 */
export const RETENTION_OPTIONS: RetentionOption[] = [
  { value: 3, name: "3日" },
  { value: 7, name: "7日" },
  { value: 15, name: "15日 (推奨)" },
  { value: 30, name: "30日" },
  { value: 90, name: "90日" },
  { value: 180, name: "180日" },
  { value: 360, name: "360日" },
];

/** Default retention period in days. */
export const DEFAULT_RETENTION_DAYS = 15;

// ═══════════════════════════════════════════════════════════════════════════
// ── Synthetics: Test Templates & Configuration ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** Available Datadog Synthetics test locations. */
export interface TestLocation {
  value: string;
  name: string;
}

/**
 * Synthetic test location options, ordered by geographic proximity to Japan.
 * The default checked location is aws:ap-northeast-1 (Tokyo).
 */
export const TEST_LOCATIONS: TestLocation[] = [
  { value: "aws:ap-northeast-1", name: "Tokyo (ap-northeast-1)" },
  { value: "aws:us-east-1", name: "N. Virginia (us-east-1)" },
  { value: "aws:eu-west-1", name: "Ireland (eu-west-1)" },
  { value: "aws:ap-southeast-1", name: "Singapore (ap-southeast-1)" },
  { value: "aws:us-west-2", name: "Oregon (us-west-2)" },
];

/** Default test location value (pre-checked in the wizard). */
export const DEFAULT_TEST_LOCATION = "aws:ap-northeast-1";

/** Synthetic test frequency option. */
export interface FrequencyOption {
  /** Interval in seconds. */
  value: number;
  name: string;
}

/**
 * Check frequency options shown in the Synthetics module select prompt.
 * The default selection is 300 seconds (5 minutes).
 */
export const SYNTHETIC_FREQUENCIES: FrequencyOption[] = [
  { value: 60, name: "1分" },
  { value: 300, name: "5分 (推奨)" },
  { value: 900, name: "15分" },
  { value: 1800, name: "30分" },
  { value: 3600, name: "1時間" },
];

/** Default check frequency in seconds. */
export const DEFAULT_FREQUENCY_SECONDS = 300;

/** Template for a single API test definition (before Datadog API submission). */
export interface ApiTestTemplate {
  name: string;
  url: string;
  method: "GET" | "POST" | "HEAD";
  expectedStatus: number;
  maxResponseTime: number;
}

/**
 * Build the Datadog Synthetics API test body for a given template.
 * The caller must prefix the name with RESOURCE_PREFIX and supply locations/frequency.
 */
export interface SyntheticsApiTestBody {
  name: string;
  type: "api";
  subtype: "http";
  config: {
    request: { method: string; url: string };
    assertions: Array<Record<string, unknown>>;
  };
  options: {
    tickEvery: number;
    minLocationFailed: number;
    retry: { count: number; interval: number };
  };
  locations: string[];
  message: string;
  tags: string[];
  status: "live" | "paused";
}

/**
 * Build a Datadog Synthetics API test request body from a template.
 *
 * @param template      - The API test definition (URL, method, assertions).
 * @param locations     - Location IDs to run the test from.
 * @param frequency     - Check interval in seconds.
 * @param notificationHandle - Datadog notification handle (e.g. "@pagerduty-...").
 * @param resourcePrefix - Prefix prepended to the test name (e.g. "[DDConnect]").
 */
export function buildSyntheticsApiTestBody(
  template: ApiTestTemplate,
  locations: string[],
  frequency: number,
  notificationHandle: string,
  resourcePrefix: string
): SyntheticsApiTestBody {
  return {
    name: `${resourcePrefix} ${template.name}`,
    type: "api",
    subtype: "http",
    config: {
      request: {
        method: template.method,
        url: template.url,
      },
      assertions: [
        {
          type: "statusCode",
          operator: "is",
          target: template.expectedStatus,
        },
        {
          type: "responseTime",
          operator: "lessThan",
          target: template.maxResponseTime,
        },
      ],
    },
    options: {
      tickEvery: frequency,
      minLocationFailed: 1,
      retry: { count: 1, interval: 300 },
    },
    locations,
    message: `${template.name} が失敗しています\n\n${notificationHandle}`,
    tags: ["managed:datadog-connect"],
    status: "live",
  };
}

/** Tag used to identify Datadog Connect-managed synthetic tests. */
export const SYNTHETICS_MANAGED_TAG = "managed:datadog-connect";
