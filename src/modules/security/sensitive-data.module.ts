import { checkbox, select } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import {
  SENSITIVE_DATA_PATTERNS,
  SENSITIVE_DATA_ACTIONS,
  SENSITIVE_DATA_ACTION_TYPE_MAP,
  SENSITIVE_DATA_MASK_REPLACEMENT,
  SENSITIVE_DATA_PRODUCT_LIST,
  SENSITIVE_DATA_DEFAULT_FILTER_QUERY,
} from "../../knowledge/security-rules.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { McpToolCall, ModulePlan } from "../../orchestrator/mcp-call.js";

const ACTION_TYPE_MAP = SENSITIVE_DATA_ACTION_TYPE_MAP as Record<string, string>;
const PATTERN_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  SENSITIVE_DATA_PATTERNS.map((p) => [p.value, p.matchKeywords as string[]])
);

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

  async preflight(client: unknown): Promise<PreflightResult> {
    try {
      await (client as any).security.sensitiveData.listScanningGroups();
      return { available: true };
    } catch {
      return {
        available: false,
        reason:
          "Sensitive Data Scanner はPro以上のプランが必要です",
      };
    }
  }

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as SensitiveDataConfig;
    const calls: McpToolCall[] = [];

    const patterns = cfg.patterns ?? [];
    const actionType = cfg.actionType ?? "mask";

    const textReplacementType = ACTION_TYPE_MAP[actionType] ?? "none";

    // Build pattern definitions lookup for fallback regex
    const patternDefs = Object.fromEntries(
      SENSITIVE_DATA_PATTERNS.map((p) => [p.value, p])
    );

    // Step 1: Create scanning group
    const groupName = `${RESOURCE_PREFIX} Sensitive Data Scanner`;
    const groupCallId = "create_scanning_group";

    calls.push({
      id: groupCallId,
      tool: "datadog_create_sensitive_data_scanning_group",
      parameters: {
        name: groupName,
        description: "Managed by datadog-connect",
        is_enabled: true,
        product_list: [...SENSITIVE_DATA_PRODUCT_LIST],
        filter: {
          query: SENSITIVE_DATA_DEFAULT_FILTER_QUERY,
        },
      },
      description: `Sensitive Data Scannerグループ「${groupName}」を作成`,
      rollbackCall: {
        tool: "datadog_delete_sensitive_data_scanning_group",
        parameters: { group_id: "{{created_id}}" },
        description: `スキャニンググループ「${groupName}」を削除`,
      },
    });

    // Step 2: Create scanning rules for each selected pattern
    for (const patternKey of patterns) {
      const patternDef = patternDefs[patternKey];
      const ruleName = `${RESOURCE_PREFIX} ${patternKey}`;

      const textReplacement: Record<string, unknown> = {
        type: textReplacementType,
      };
      if (textReplacementType === "replacement_string") {
        textReplacement["replacement_string"] = SENSITIVE_DATA_MASK_REPLACEMENT;
      }

      const ruleParameters: Record<string, unknown> = {
        name: ruleName,
        description: `Managed by datadog-connect: ${patternKey}`,
        is_enabled: true,
        tags: ["managed:datadog-connect"],
        text_replacement: textReplacement,
        group_id: "<GROUP_ID: ステップ1のレスポンスから取得>",
      };

      // Use fallback regex pattern; standard pattern matched at runtime
      if (patternDef?.fallbackRegex) {
        ruleParameters["pattern"] = patternDef.fallbackRegex;
      }

      // Include keyword hints for standard pattern matching at execution time
      if (patternDef?.matchKeywords) {
        ruleParameters["match_keywords"] = patternDef.matchKeywords;
      }

      calls.push({
        tool: "datadog_create_sensitive_data_scanning_rule",
        parameters: ruleParameters,
        description: `スキャニングルール「${patternKey}」を作成`,
        dependsOn: [groupCallId],
        rollbackCall: {
          tool: "datadog_delete_sensitive_data_scanning_rule",
          parameters: { rule_id: "{{created_id}}" },
          description: `スキャニングルール「${ruleName}」を削除`,
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
          tool: "datadog_list_sensitive_data_scanning_groups",
          parameters: {},
          description: "スキャニンググループとルールの一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<SensitiveDataConfig> {
    const patterns = await checkbox({
      message: "検出するパターンを選択:",
      choices: SENSITIVE_DATA_PATTERNS.map((p) => ({
        value: p.value,
        name: p.name,
        checked: p.defaultChecked,
      })),
    });

    const actionType = await select({
      message: "検出時のアクション:",
      choices: SENSITIVE_DATA_ACTIONS.map((a) => ({ value: a.value, name: a.name })),
    });

    return { patterns, actionType };
  }

  async execute(
    config: SensitiveDataConfig,
    client: unknown
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    // 1. 標準パターン一覧を取得
    let standardPatterns: Array<{ id?: string; attributes?: { name?: string } }> =
      [];
    try {
      const stdResp = await (client as any).security.sensitiveData.listStandardPatterns();
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
      const groupResp = await (client as any).security.sensitiveData.createScanningGroup({
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
        } as unknown as any,
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
                ? { replacementString: SENSITIVE_DATA_MASK_REPLACEMENT }
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
          const fallbackPatterns: Record<string, string> = Object.fromEntries(
            SENSITIVE_DATA_PATTERNS.map((p) => [p.value, p.fallbackRegex])
          );
          (ruleBody["attributes"] as Record<string, unknown>)["pattern"] =
            fallbackPatterns[patternKey] ?? patternKey;
        }

        const ruleResp = await (client as any).security.sensitiveData.createScanningRule(
          {
            body: {
              data: ruleBody,
              meta: { version: 0 },
            } as unknown as any,
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

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).security.sensitiveData.listScanningGroups();
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
