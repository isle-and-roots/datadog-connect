import { checkbox, select, input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { v1 } from "@datadog/datadog-api-client";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

const LOG_SOURCES = [
  { value: "application", name: "アプリケーションログ" },
  { value: "nginx", name: "Nginx" },
  { value: "apache", name: "Apache" },
  { value: "docker", name: "Docker / コンテナ" },
  { value: "syslog", name: "Syslog" },
  { value: "json", name: "JSON形式ログ" },
  { value: "custom", name: "カスタム形式" },
];

const RETENTION_OPTIONS = [
  { value: 3, name: "3日" },
  { value: 7, name: "7日" },
  { value: 15, name: "15日 (推奨)" },
  { value: 30, name: "30日" },
  { value: 90, name: "90日" },
  { value: 180, name: "180日" },
  { value: 360, name: "360日" },
];

interface LogsConfig extends ModuleConfig {
  sources: string[];
  retentionDays: number;
  enableAnomaly: boolean;
  enableSensitiveData: boolean;
}

class LogsModule extends BaseModule {
  readonly id = "logs";
  readonly name = "ログ管理";
  readonly description = "ログパイプライン・インデックスを設定";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<LogsConfig> {
    const sources = await checkbox({
      message: "ログソース:",
      choices: LOG_SOURCES.map((s) => ({ ...s, checked: false })),
    });

    const retentionDays = await select({
      message: "ログ保持期間:",
      choices: RETENTION_OPTIONS.map((r) => ({ value: r.value, name: r.name })),
      default: 15,
    });

    const enableAnomaly = await confirm({
      message: "ログ異常検出を有効にしますか？",
      default: true,
    });

    const enableSensitiveData = await confirm({
      message: "Sensitive Data Scanner (PII検出) を有効にしますか？",
      default: false,
    });

    return { sources, retentionDays, enableAnomaly, enableSensitiveData };
  }

  async execute(config: LogsConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    // Create log pipelines for each source
    for (const source of config.sources) {
      const pipelineDef = getPipelineDefinition(source);
      if (!pipelineDef) continue;

      try {
        const resp = await client.v1.logsPipelines.createLogsPipeline({
          body: {
            name: `${RESOURCE_PREFIX} ${pipelineDef.name}`,
            isEnabled: true,
            filter: { query: pipelineDef.filterQuery },
            processors: pipelineDef.processors as unknown as v1.LogsProcessor[],
          },
        });

        resources.push({
          type: "logs_pipeline",
          id: resp.id ?? "",
          name: `Pipeline: ${pipelineDef.name}`,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`パイプライン作成: ${pipelineDef.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`パイプライン「${pipelineDef.name}」作成失敗: ${msg}`);
      }
    }

    return { success: errors.length === 0, resources, manualSteps: [], errors };
  }

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const pipelines = await client.v1.logsPipelines.listLogsPipelines();
      const managed = pipelines.filter((p) =>
        p.name?.startsWith(RESOURCE_PREFIX)
      );
      checks.push({
        name: "ログパイプライン確認",
        passed: managed.length >= this.createdResources.length,
        detail: `${managed.length}件のパイプライン`,
      });
    } catch (err) {
      checks.push({
        name: "パイプライン確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

interface PipelineDef {
  name: string;
  filterQuery: string;
  processors: Array<Record<string, unknown>>;
}

function getPipelineDefinition(source: string): PipelineDef | null {
  const defs: Record<string, PipelineDef> = {
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
            matchRules: "syslog %{date(\"MMM dd HH:mm:ss\"):date} %{word:host} %{word:program}(\\[%{number:pid}\\])?: %{data:message}",
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

  return defs[source] ?? null;
}

registerModule(new LogsModule());
