import { checkbox, select } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import {
  promptNotification,
  formatNotificationHandle,
} from "../shared/notifications.js";
import { SIEM_PACKS, SIEM_DEFAULT_OPTIONS } from "../../knowledge/security-rules.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { McpToolCall, ModulePlan } from "../../orchestrator/mcp-call.js";

const PACKS: Record<string, { label: string; count: number; rules: readonly { name: string; query: string; groupByFields: string[]; status: "high" | "medium"; condition: string; message: string }[] }> = SIEM_PACKS;

interface SiemConfig extends ModuleConfig {
  packs: string[];
  notificationHandle: string;
}

class SiemModule extends BaseModule {
  readonly id = "siem";
  readonly name = "SIEM (セキュリティ監視)";
  readonly description = "セキュリティ検出ルールパックを自動作成";
  readonly category = "security" as const;
  readonly dependencies: string[] = ["logs"];

  async preflight(client: unknown): Promise<PreflightResult> {
    try {
      await (client as any).security.monitoring.listSecurityMonitoringRules({
        pageSize: 1,
      });
      return { available: true };
    } catch {
      return {
        available: false,
        reason: "SIEM (Security Monitoring) はPro以上のプランが必要です",
      };
    }
  }

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as SiemConfig;
    const calls: McpToolCall[] = [];

    const packs = cfg.packs ?? [];
    const notificationHandle = cfg.notificationHandle ?? "";

    for (const packId of packs) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const ruleDef of pack.rules) {
        const ruleName = `${RESOURCE_PREFIX} ${ruleDef.name}`;

        calls.push({
          tool: "datadog_create_security_monitoring_rule",
          parameters: {
            name: ruleName,
            queries: [
              {
                query: ruleDef.query,
                group_by_fields: ruleDef.groupByFields,
                aggregation: "count",
              },
            ],
            cases: [
              {
                status: ruleDef.status,
                condition: ruleDef.condition,
              },
            ],
            message: `${ruleDef.message}\n\n${notificationHandle}`,
            is_enabled: true,
            type: "log_detection",
            options: {
              evaluation_window: SIEM_DEFAULT_OPTIONS.evaluationWindow,
              keep_alive: SIEM_DEFAULT_OPTIONS.keepAlive,
              max_signal_duration: SIEM_DEFAULT_OPTIONS.maxSignalDuration,
            },
            tags: [
              `pack:${packId}`,
              `${RESOURCE_PREFIX}managed:datadog-connect`,
              "managed:datadog-connect",
            ],
          },
          description: `SIEMルール「${ruleDef.name}」を作成 (パック: ${packId})`,
          rollbackCall: {
            tool: "datadog_delete_security_monitoring_rule",
            parameters: { rule_id: "{{created_id}}" },
            description: `SIEMルール「${ruleName}」を削除`,
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
          tool: "datadog_list_security_monitoring_rules",
          parameters: { query: "managed:datadog-connect" },
          description: "作成したSIEMルール一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<SiemConfig> {
    const packs = await checkbox({
      message: "インストールする検出ルールパック:",
      choices: Object.entries(PACKS).map(([key, pack]) => ({
        value: key,
        name: `${pack.label} — ${pack.count}ルール`,
        checked: true,
      })),
    });

    const notification = await promptNotification();
    const notificationHandle = formatNotificationHandle(notification);

    return { packs, notificationHandle };
  }

  async execute(
    config: SiemConfig,
    client: unknown
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const packId of config.packs) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const ruleDef of pack.rules) {
        const ruleName = `${RESOURCE_PREFIX} ${ruleDef.name}`;
        try {
          const resp = await (client as any).security.monitoring.createSecurityMonitoringRule(
            {
              body: {
                name: ruleName,
                queries: [
                  {
                    query: ruleDef.query,
                    groupByFields: ruleDef.groupByFields,
                    aggregation: "count",
                  },
                ],
                cases: [
                  {
                    status: ruleDef.status,
                    condition: ruleDef.condition,
                  },
                ],
                message: `${ruleDef.message}\n\n${config.notificationHandle}`,
                isEnabled: true,
                type: "log_detection",
                options: {
                  evaluationWindow: 300,
                  keepAlive: 3600,
                  maxSignalDuration: 86400,
                },
                tags: [
                  `pack:${packId}`,
                  `${RESOURCE_PREFIX}managed:datadog-connect`,
                  "managed:datadog-connect",
                ],
              } as unknown as any,
            }
          );

          const ruleResp = resp as unknown as { id?: string };
          const id = ruleResp.id ?? "";
          this.createdResources.push({
            type: "siem_rule",
            id: String(id),
            name: ruleName,
            createdAt: new Date().toISOString(),
          });
          resources.push({
            type: "siem_rule",
            id: String(id),
            name: ruleName,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`SIEMルール作成: ${ruleDef.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`SIEMルール「${ruleDef.name}」作成失敗: ${msg}`);
        }
      }
    }

    // 通知ルールは型が厳密なためスキップ
    // (createSignalNotificationRule の型定義がSDKバージョンにより異なる)

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
      const resp = await (client as any).security.monitoring.listSecurityMonitoringRules(
        {
          query: "managed:datadog-connect",
        }
      );
      const rules = (resp as unknown as { data?: unknown[] }).data ?? [];
      const count = rules.length;
      const expected = this.createdResources.length;
      checks.push({
        name: "作成SIEMルール数の確認",
        passed: count >= expected,
        detail: `${count}/${expected} ルールが存在`,
      });
    } catch (err) {
      checks.push({
        name: "SIEMルール確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new SiemModule());
