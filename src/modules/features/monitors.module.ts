import { checkbox, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptNotification, formatNotificationHandle } from "../shared/notifications.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { MONITOR_PACKS } from "../../knowledge/monitor-packs.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
} from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";

const PACKS: Record<string, { label: string; monitors: Array<{ name: string; type: string; query: string; message: string; thresholds: { critical: number; warning?: number } }> }> = Object.fromEntries(
  Object.entries(MONITOR_PACKS).map(([key, pack]) => [key, { label: pack.label, monitors: pack.monitors }])
);

interface MonitorsConfig extends ModuleConfig {
  packs: string[];
  useDefaults: boolean;
  notificationHandle: string;
}

class MonitorsModule extends BaseModule {
  readonly id = "monitors";
  readonly name = "モニター/アラート";
  readonly description = "推奨モニターパックを自動作成";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as MonitorsConfig;
    const calls: McpToolCall[] = [];

    for (const packId of cfg.packs ?? []) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const mon of pack.monitors) {
        const monitorName = `${RESOURCE_PREFIX} ${mon.name}`;
        calls.push({
          tool: "datadog_create_monitor",
          parameters: {
            type: mon.type,
            query: mon.query,
            name: monitorName,
            message: `${mon.message}\n\n${cfg.notificationHandle ?? ""}`,
            thresholds: mon.thresholds,
            tags: [`pack:${packId}`, "managed:datadog-connect"],
          },
          description: `モニター「${mon.name}」を作成`,
          rollbackCall: {
            tool: "datadog_delete_monitor",
            parameters: { monitor_id: "{{created_id}}" },
            description: `モニター「${mon.name}」を削除`,
          },
        });
      }
    }

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps: [],
      verificationCalls: [
        {
          tool: "datadog_list_monitors",
          parameters: { tags: "managed:datadog-connect" },
          description: "管理対象モニターの一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<MonitorsConfig> {
    const packs = await checkbox({
      message: "インストールするモニターパック:",
      choices: Object.entries(PACKS).map(([key, pack]) => ({
        value: key,
        name: `${pack.label} (${pack.monitors.length}件)`,
        checked: true,
      })),
    });

    const useDefaults = await confirm({
      message: "推奨閾値をそのまま使用しますか？",
      default: true,
    });

    const notification = await promptNotification();
    const notificationHandle = formatNotificationHandle(notification);

    return { packs, useDefaults, notificationHandle };
  }

  async execute(
    config: MonitorsConfig,
    client: unknown
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const packId of config.packs) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const monDef of pack.monitors) {
        try {
          const resp = await (client as any).v1.monitors.createMonitor({
            body: {
              name: `${RESOURCE_PREFIX} ${monDef.name}`,
              type: monDef.type as "metric alert",
              query: monDef.query,
              message: `${monDef.message}\n\n${config.notificationHandle}`,
              options: {
                thresholds: monDef.thresholds,
                notifyNoData: monDef.type === "service check",
                noDataTimeframe: monDef.type === "service check" ? 10 : undefined,
              },
              tags: [`pack:${packId}`, "managed:datadog-connect"],
            },
          });

          resources.push({
            type: "monitor",
            id: String(resp.id ?? ""),
            name: `${RESOURCE_PREFIX} ${monDef.name}`,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`モニター作成: ${monDef.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`モニター「${monDef.name}」作成失敗: ${msg}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      resources,
      manualSteps: [],
      errors,
    };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v1.monitors.listMonitors({
        tags: "managed:datadog-connect",
      });
      const count = resp.length;
      const expected = this.createdResources.length;
      checks.push({
        name: "作成モニター数の確認",
        passed: count >= expected,
        detail: `${count}/${expected} モニターが存在`,
      });
    } catch (err) {
      checks.push({
        name: "モニター確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new MonitorsModule());
