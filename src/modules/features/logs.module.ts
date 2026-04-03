import { checkbox, select, input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { LOG_SOURCES, RETENTION_OPTIONS, LOG_PIPELINE_DEFS } from "../../knowledge/apm-guides.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";

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

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as LogsConfig;
    const calls: McpToolCall[] = [];

    for (const source of cfg.sources ?? []) {
      const pipelineDef = LOG_PIPELINE_DEFS[source as keyof typeof LOG_PIPELINE_DEFS] ?? null;
      if (!pipelineDef) continue;

      const pipelineName = `${RESOURCE_PREFIX} ${pipelineDef.name}`;
      calls.push({
        tool: "datadog_create_logs_pipeline",
        parameters: {
          name: pipelineName,
          is_enabled: true,
          filter: { query: pipelineDef.filterQuery },
          processors: pipelineDef.processors,
        },
        description: `ログパイプライン「${pipelineDef.name}」を作成`,
        rollbackCall: {
          tool: "datadog_delete_logs_pipeline",
          parameters: { pipeline_id: "{{created_id}}" },
          description: `ログパイプライン「${pipelineDef.name}」を削除`,
        },
      });
    }

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps: [],
      verificationCalls: [
        {
          tool: "datadog_list_logs_pipelines",
          parameters: {},
          description: "ログパイプライン一覧を取得して作成確認",
        },
      ],
    };
  }

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

  async execute(config: LogsConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    // Create log pipelines for each source
    for (const source of config.sources) {
      const pipelineDef = LOG_PIPELINE_DEFS[source as keyof typeof LOG_PIPELINE_DEFS] ?? null;
      if (!pipelineDef) continue;

      try {
        const resp = await (client as any).v1.logsPipelines.createLogsPipeline({
          body: {
            name: `${RESOURCE_PREFIX} ${pipelineDef.name}`,
            isEnabled: true,
            filter: { query: pipelineDef.filterQuery },
            processors: pipelineDef.processors as unknown[],
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

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const pipelines = await (client as any).v1.logsPipelines.listLogsPipelines();
      const managed = pipelines.filter((p: any) =>
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

registerModule(new LogsModule());
