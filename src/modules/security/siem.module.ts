import { checkbox, select } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import {
  promptNotification,
  formatNotificationHandle,
} from "../shared/notifications.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── ルール定義 ──

interface SiemRuleDef {
  name: string;
  query: string;
  groupByFields: string[];
  status: "high" | "medium";
  condition: string;
  message: string;
}

const CLOUD_RULES: SiemRuleDef[] = [
  {
    name: "不正APIコール検出",
    query: "source:cloudtrail @eventName:(DeleteBucket OR DeleteTrail OR StopLogging) @errorCode:Success",
    groupByFields: ["@userIdentity.arn"],
    status: "high",
    condition: "a > 0",
    message: "不正なAPIコール (@eventName) が検出されました。ユーザー: @userIdentity.arn",
  },
  {
    name: "権限昇格の試み",
    query: "source:cloudtrail @eventName:(AttachUserPolicy OR AttachRolePolicy OR CreatePolicy) @errorCode:Success",
    groupByFields: ["@userIdentity.arn"],
    status: "high",
    condition: "a > 0",
    message: "権限昇格の試みが検出されました。アクション: @eventName、ユーザー: @userIdentity.arn",
  },
  {
    name: "クラウドリソース大量削除",
    query: "source:cloudtrail @eventName:Delete* @errorCode:Success",
    groupByFields: ["@userIdentity.arn"],
    status: "medium",
    condition: "a > 20",
    message: "短時間にクラウドリソースの大量削除が発生しました。ユーザー: @userIdentity.arn",
  },
];

const AUTH_RULES: SiemRuleDef[] = [
  {
    name: "ブルートフォース攻撃検出",
    query: "source:auth @evt.outcome:failure",
    groupByFields: ["@network.client.ip"],
    status: "high",
    condition: "a > 10",
    message: "ブルートフォース攻撃の疑いがあります。送信元IP: @network.client.ip",
  },
  {
    name: "異常ログイン（新規国からのアクセス）",
    query: "source:auth @evt.outcome:success",
    groupByFields: ["@usr.name", "@network.client.geoip.country.iso_code"],
    status: "medium",
    condition: "a > 0",
    message: "通常と異なる国からのログインが検出されました。ユーザー: @usr.name、国: @network.client.geoip.country.iso_code",
  },
  {
    name: "特権アカウントへの異常アクセス",
    query: "source:auth @usr.name:(root OR admin OR administrator) @evt.outcome:success",
    groupByFields: ["@network.client.ip"],
    status: "high",
    condition: "a > 0",
    message: "特権アカウントへのアクセスが検出されました。IP: @network.client.ip",
  },
];

const NETWORK_RULES: SiemRuleDef[] = [
  {
    name: "ポートスキャン検出",
    query: "source:firewall @evt.name:connection @network.destination.port:*",
    groupByFields: ["@network.client.ip"],
    status: "medium",
    condition: "a > 100",
    message: "ポートスキャンの疑いがあります。送信元IP: @network.client.ip",
  },
  {
    name: "不審な外部通信",
    query: "source:firewall @direction:outbound @network.bytes_written:>10000000",
    groupByFields: ["@network.client.ip", "@network.destination.ip"],
    status: "high",
    condition: "a > 0",
    message: "大量のデータが外部に送信されています。送信元: @network.client.ip、送信先: @network.destination.ip",
  },
];

const APP_RULES: SiemRuleDef[] = [
  {
    name: "SQLインジェクション検出",
    query: "source:nginx @http.url_details.path:* (@http.url_details.queryString:*SELECT* OR @http.url_details.queryString:*UNION* OR @http.url_details.queryString:*DROP*)",
    groupByFields: ["@network.client.ip"],
    status: "high",
    condition: "a > 0",
    message: "SQLインジェクションの試みが検出されました。送信元IP: @network.client.ip",
  },
  {
    name: "XSS攻撃検出",
    query: "source:nginx @http.url_details.queryString:*<script*",
    groupByFields: ["@network.client.ip"],
    status: "high",
    condition: "a > 0",
    message: "XSS攻撃の試みが検出されました。送信元IP: @network.client.ip",
  },
];

const PACKS: Record<
  string,
  { label: string; count: number; rules: SiemRuleDef[] }
> = {
  cloud: {
    label: "クラウドセキュリティ (不正APIコール, 権限昇格)",
    count: 3,
    rules: CLOUD_RULES,
  },
  auth: {
    label: "認証セキュリティ (ブルートフォース, 異常ログイン)",
    count: 3,
    rules: AUTH_RULES,
  },
  network: {
    label: "ネットワーク (ポートスキャン)",
    count: 2,
    rules: NETWORK_RULES,
  },
  app: {
    label: "アプリケーション (SQLi, XSS)",
    count: 2,
    rules: APP_RULES,
  },
};

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

  async preflight(client: DatadogClient): Promise<PreflightResult> {
    try {
      await client.security.monitoring.listSecurityMonitoringRules({
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
    client: DatadogClient
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const packId of config.packs) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const ruleDef of pack.rules) {
        const ruleName = `${RESOURCE_PREFIX} ${ruleDef.name}`;
        try {
          const resp = await client.security.monitoring.createSecurityMonitoringRule(
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
              } as unknown as Parameters<
                typeof client.security.monitoring.createSecurityMonitoringRule
              >[0]["body"],
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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.security.monitoring.listSecurityMonitoringRules(
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
