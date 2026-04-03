import { checkbox } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { DASHBOARD_PRESETS, getDashboardSpec } from "../../knowledge/dashboard-specs.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";

interface DashboardsConfig extends ModuleConfig {
  presets: string[];
}

class DashboardsModule extends BaseModule {
  readonly id = "dashboards";
  readonly name = "ダッシュボード";
  readonly description = "推奨ダッシュボードを自動作成";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as DashboardsConfig;
    const calls: McpToolCall[] = [];

    for (const presetId of cfg.presets ?? []) {
      const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
      if (!preset) continue;

      const spec = getDashboardSpec(presetId);
      const title = `${RESOURCE_PREFIX} ${preset.name}`;

      calls.push({
        tool: "datadog_create_dashboard",
        parameters: {
          title,
          widgets: spec.widgets,
          layout_type: "ordered",
          template_variables: spec.templateVariables,
        },
        description: `ダッシュボード「${preset.name}」を作成`,
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
          tool: "datadog_list_dashboards",
          parameters: {},
          description: "ダッシュボード一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<DashboardsConfig> {
    const presets = await checkbox({
      message: "作成するダッシュボード:",
      choices: DASHBOARD_PRESETS.map((p) => ({
        value: p.id,
        name: `${p.name} — ${p.description}`,
        checked: true,
      })),
    });

    return { presets };
  }

  async execute(config: DashboardsConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const presetId of config.presets) {
      const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
      if (!preset) continue;

      const spec = getDashboardSpec(presetId);

      try {
        const resp = await (client as any).v1.dashboards.createDashboard({
          body: {
            title: `${RESOURCE_PREFIX} ${preset.name}`,
            description: preset.description,
            layoutType: "ordered",
            widgets: spec.widgets as unknown[],
            templateVariables: spec.templateVariables as unknown[] | undefined,
          },
        });

        resources.push({
          type: "dashboard",
          id: resp.id ?? "",
          name: `Dashboard: ${preset.name}`,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`ダッシュボード作成: ${preset.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`ダッシュボード「${preset.name}」作成失敗: ${msg}`);
      }
    }

    return { success: errors.length === 0, resources, manualSteps: [], errors };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v1.dashboards.listDashboards();
      const managed = (resp.dashboards ?? []).filter((d: any) =>
        d.title?.startsWith(RESOURCE_PREFIX)
      );
      checks.push({
        name: "ダッシュボード作成確認",
        passed: managed.length >= this.createdResources.length,
        detail: `${managed.length}件のダッシュボード`,
      });
    } catch (err) {
      checks.push({
        name: "ダッシュボード確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new DashboardsModule());
