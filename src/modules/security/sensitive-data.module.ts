import { checkbox, select } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── アクションマッピング ──

const ACTION_TYPE_MAP: Record<string, string> = {
  mask: "replacement_string",
  hash: "hash",
  notify: "none",
};

// ── パターンキーワードマッチング ──
// 標準パターンの name フィールドで部分一致を試みる

const PATTERN_KEYWORDS: Record<string, string[]> = {
  pii: ["name", "address", "my number", "マイナンバー", "個人", "住所", "氏名"],
  "credit-card": ["credit card", "visa", "mastercard", "card number", "クレジット"],
  "api-key": ["api key", "api token", "access token", "secret key", "トークン"],
  email: ["email", "e-mail", "メール"],
  phone: ["phone", "telephone", "電話"],
};

interface SensitiveDataConfig extends ModuleConfig {
  patterns: string[];
  actionType: string;
}

class SensitiveDataModule extends BaseModule {
  readonly id = "sensitive-data";
  readonly name = "Sensitive Data Scanner";
  readonly description = "機密データの自動検出とマスキングルールを設定";
  readonly category = "security" as const;
  readonly dependencies: string[] = ["logs"];

  async preflight(client: DatadogClient): Promise<PreflightResult> {
    try {
      await client.security.sensitiveData.listScanningGroups();
      return { available: true };
    } catch {
      return {
        available: false,
        reason:
          "Sensitive Data Scanner はPro以上のプランが必要です",
      };
    }
  }

  async prompt(): Promise<SensitiveDataConfig> {
    const patterns = await checkbox({
      message: "検出するパターンを選択:",
      choices: [
        {
          value: "pii",
          name: "個人情報 (氏名, 住所, マイナンバー)",
          checked: true,
        },
        {
          value: "credit-card",
          name: "クレジットカード番号",
          checked: true,
        },
        {
          value: "api-key",
          name: "APIキー・トークン",
          checked: true,
        },
        {
          value: "email",
          name: "メールアドレス",
          checked: false,
        },
        {
          value: "phone",
          name: "電話番号",
          checked: false,
        },
      ],
    });

    const actionType = await select({
      message: "検出時のアクション:",
      choices: [
        { value: "mask", name: "マスク" },
        { value: "hash", name: "ハッシュ化" },
        { value: "notify", name: "通知のみ" },
      ],
    });

    return { patterns, actionType };
  }

  async execute(
    config: SensitiveDataConfig,
    client: DatadogClient
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    // 1. 標準パターン一覧を取得
    let standardPatterns: Array<{ id?: string; attributes?: { name?: string } }> =
      [];
    try {
      const stdResp = await client.security.sensitiveData.listStandardPatterns();
      standardPatterns =
        (
          stdResp as unknown as {
            data?: Array<{ id?: string; attributes?: { name?: string } }>;
          }
        ).data ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`標準パターン取得失敗: ${msg}`);
      // 標準パターンが取得できなくてもグループ作成は継続
    }

    // 2. スキャニンググループを作成
    const groupName = `${RESOURCE_PREFIX} Sensitive Data Scanner`;
    let groupId: string | undefined;

    try {
      const groupResp = await client.security.sensitiveData.createScanningGroup({
        body: {
          data: {
            type: "sensitive_data_scanner_group",
            attributes: {
              name: groupName,
              description: "Managed by datadog-connect",
              isEnabled: true,
              productList: ["logs"],
              filter: {
                query: "*",
              },
            },
          },
          meta: {
            version: 0,
          },
        } as unknown as Parameters<
          typeof client.security.sensitiveData.createScanningGroup
        >[0]["body"],
      });

      const groupData = (
        groupResp as unknown as { data?: { id?: string } }
      ).data;
      groupId = groupData?.id;

      this.createdResources.push({
        type: "sensitive_data_group",
        id: String(groupId ?? ""),
        name: groupName,
        createdAt: new Date().toISOString(),
      });
      resources.push({
        type: "sensitive_data_group",
        id: String(groupId ?? ""),
        name: groupName,
        createdAt: new Date().toISOString(),
      });

      printSuccess(`スキャニンググループ作成: ${groupName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`グループ「${groupName}」作成失敗: ${msg}`);
      return {
        success: false,
        resources,
        manualSteps: [],
        errors,
      };
    }

    // 3. 選択されたパターンごとにルールを作成
    const textReplacementType = ACTION_TYPE_MAP[config.actionType] ?? "none";

    for (const patternKey of config.patterns) {
      const keywords = PATTERN_KEYWORDS[patternKey] ?? [patternKey];

      // 標準パターンからマッチするものを探す
      const matchedPattern = standardPatterns.find((p) => {
        const name = (p.attributes?.name ?? "").toLowerCase();
        return keywords.some((kw) => name.includes(kw.toLowerCase()));
      });

      const ruleName = `${RESOURCE_PREFIX} ${patternKey}`;
      try {
        const ruleBody: Record<string, unknown> = {
          type: "sensitive_data_scanner_rule",
          attributes: {
            name: ruleName,
            description: `Managed by datadog-connect: ${patternKey}`,
            isEnabled: true,
            tags: ["managed:datadog-connect"],
            textReplacement: {
              type: textReplacementType,
              ...(textReplacementType === "replacement_string"
                ? { replacementString: "****" }
                : {}),
            },
          },
          relationships: {
            group: {
              data: {
                type: "sensitive_data_scanner_group",
                id: groupId,
              },
            },
            ...(matchedPattern?.id
              ? {
                  standardPattern: {
                    data: {
                      type: "sensitive_data_scanner_standard_pattern",
                      id: matchedPattern.id,
                    },
                  },
                }
              : {
                  // 標準パターンが見つからない場合は pattern フィールドでフォールバック
                }),
          },
        };

        // 標準パターンが見つからない場合は正規表現パターンを付与
        if (!matchedPattern?.id) {
          const fallbackPatterns: Record<string, string> = {
            pii: "\\b[\\p{L}\\p{M}]+\\s+[\\p{L}\\p{M}]+\\b",
            "credit-card": "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b",
            "api-key": "(?i)(?:api[_-]?key|token|secret)[\"'\\s]*[:=][\"'\\s]*[\\w\\-]{16,}",
            email: "\\b[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}\\b",
            phone: "\\b(?:\\+81|0)[\\-\\s]?\\d{1,4}[\\-\\s]?\\d{1,4}[\\-\\s]?\\d{4}\\b",
          };
          (ruleBody["attributes"] as Record<string, unknown>)["pattern"] =
            fallbackPatterns[patternKey] ?? patternKey;
        }

        const ruleResp = await client.security.sensitiveData.createScanningRule(
          {
            body: {
              data: ruleBody,
              meta: { version: 0 },
            } as unknown as Parameters<
              typeof client.security.sensitiveData.createScanningRule
            >[0]["body"],
          }
        );

        const ruleData = (
          ruleResp as unknown as { data?: { id?: string } }
        ).data;
        const ruleId = ruleData?.id ?? "";

        this.createdResources.push({
          type: "sensitive_data_rule",
          id: String(ruleId),
          name: ruleName,
          createdAt: new Date().toISOString(),
        });
        resources.push({
          type: "sensitive_data_rule",
          id: String(ruleId),
          name: ruleName,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`スキャニングルール作成: ${patternKey}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`ルール「${patternKey}」作成失敗: ${msg}`);
      }
    }

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
      const resp = await client.security.sensitiveData.listScanningGroups();
      const included =
        (
          resp as unknown as {
            included?: Array<{ type?: string; attributes?: { name?: string } }>;
          }
        ).included ?? [];

      const managedGroups = included.filter(
        (item) =>
          item.type === "sensitive_data_scanner_group" &&
          (item.attributes?.name ?? "").startsWith(RESOURCE_PREFIX)
      );
      const managedRules = included.filter(
        (item) =>
          item.type === "sensitive_data_scanner_rule" &&
          (item.attributes?.name ?? "").startsWith(RESOURCE_PREFIX)
      );

      const expectedGroups = this.createdResources.filter(
        (r) => r.type === "sensitive_data_group"
      ).length;
      const expectedRules = this.createdResources.filter(
        (r) => r.type === "sensitive_data_rule"
      ).length;

      checks.push({
        name: "スキャニンググループの確認",
        passed: managedGroups.length >= expectedGroups,
        detail: `${managedGroups.length}/${expectedGroups} グループが存在`,
      });

      checks.push({
        name: "スキャニングルールの確認",
        passed: managedRules.length >= expectedRules,
        detail: `${managedRules.length}/${expectedRules} ルールが存在`,
      });
    } catch (err) {
      checks.push({
        name: "Sensitive Data Scanner確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new SensitiveDataModule());
