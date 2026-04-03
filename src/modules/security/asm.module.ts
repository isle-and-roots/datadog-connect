import { checkbox, confirm, input } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess, printManual, printInfo } from "../../utils/prompts.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { join } from "node:path";
import {
  ASM_PROTECTION_TARGETS,
  ASM_WAF_RULES,
  generateAsmAppsecSetup,
} from "../../knowledge/security-rules.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
  ResourceRecord,
  ManualStep,
} from "../../config/types.js";
import type { McpToolCall, ModulePlan } from "../../orchestrator/mcp-call.js";

const PROTECTION_TARGETS = ASM_PROTECTION_TARGETS as readonly { value: "sqli" | "xss" | "cmdi" | "path_traversal"; name: string }[];
const WAF_RULES = ASM_WAF_RULES;

type ProtectionTarget = (typeof PROTECTION_TARGETS)[number]["value"];

interface AsmConfig extends ModuleConfig {
  enableWaf: boolean;
  protectionTargets: ProtectionTarget[];
  excludedPaths: string[];
}

class AsmModule extends BaseModule {
  readonly id = "asm";
  readonly name = "ASM (アプリケーションセキュリティ)";
  readonly description = "Application Security Management による WAF 保護";
  readonly category = "security" as const;
  readonly dependencies: string[] = ["apm"];

  async preflight(client: unknown): Promise<PreflightResult> {
    try {
      await (client as any).security.asm.listApplicationSecurityWAFCustomRules();
      return { available: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, reason: `ASM APIへのアクセスに失敗しました: ${msg}` };
    }
  }

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as AsmConfig;
    const calls: McpToolCall[] = [];
    const manualSteps: ManualStep[] = [];

    if (!cfg.enableWaf) {
      return {
        moduleId: this.id,
        moduleName: this.name,
        category: this.category,
        calls,
        manualSteps,
        verificationCalls: [],
      };
    }

    const protectionTargets = cfg.protectionTargets ?? [];
    const excludedPaths = cfg.excludedPaths ?? [];

    // Create WAF custom rule calls for each selected protection target (monitor mode)
    for (const target of protectionTargets) {
      const ruleDef = WAF_RULES[target];
      const ruleName = `${RESOURCE_PREFIX} ASM ${ruleDef.name}`;

      calls.push({
        tool: "datadog_create_asm_waf_custom_rule",
        parameters: {
          name: ruleName,
          enabled: true,
          blocking: false, // monitor mode — detection only
          conditions: [
            {
              operator: ruleDef.conditionOperator,
              parameters: {
                inputs: [{ address: ruleDef.conditionInput }],
                list: [ruleDef.conditionValue],
              },
            },
          ],
          tags: {
            type: ruleDef.category,
            category: "attack_attempt",
          },
        },
        description: `WAFカスタムルール「${ruleDef.name}」をmonitorモードで作成`,
        rollbackCall: {
          tool: "datadog_delete_asm_waf_custom_rule",
          parameters: { rule_id: "{{created_id}}" },
          description: `WAFカスタムルール「${ruleName}」を削除`,
        },
      });
    }

    // Create exclusion filter if paths are specified
    if (excludedPaths.length > 0) {
      const filterName = `${RESOURCE_PREFIX} ASM Exclusion Filter`;
      calls.push({
        tool: "datadog_create_asm_waf_exclusion_filter",
        parameters: {
          name: filterName,
          enabled: true,
          description: `Managed by datadog-connect: exclude paths (${filterName})`,
          path_glob: excludedPaths.join(","),
          scope: [],
          rules_target: [],
        },
        description: `WAF除外フィルター作成: ${excludedPaths.join(", ")}`,
        rollbackCall: {
          tool: "datadog_delete_asm_waf_exclusion_filter",
          parameters: { filter_id: "{{created_id}}" },
          description: `WAF除外フィルター「${filterName}」を削除`,
        },
      });
    }

    // Manual step: DD_APPSEC_ENABLED setup instructions
    const setupContent = generateAsmAppsecSetup(excludedPaths);
    manualSteps.push({
      title: "ASM 有効化 (DD_APPSEC_ENABLED)",
      description:
        "各サービスの起動環境変数またはdatadog.yamlに DD_APPSEC_ENABLED=true を設定し、サービスを再起動してください",
      commands: [
        "# 環境変数で設定する場合",
        "export DD_APPSEC_ENABLED=true",
        "",
        "# または datadog.yaml で設定する場合",
        "# appsec_enabled: true",
        "",
        "# 詳細手順:",
        setupContent,
      ],
    });

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps,
      verificationCalls: [
        {
          tool: "datadog_list_asm_waf_custom_rules",
          parameters: {},
          description: "WAFカスタムルール一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<AsmConfig> {
    const enableWaf = await confirm({
      message: "WAFカスタムルールを有効化しますか？",
      default: true,
    });

    let protectionTargets: ProtectionTarget[] = [];
    let excludedPaths: string[] = [];

    if (enableWaf) {
      protectionTargets = await checkbox<ProtectionTarget>({
        message: "保護対象を選択してください:",
        choices: PROTECTION_TARGETS.map((t) => ({
          value: t.value,
          name: t.name,
          checked: true,
        })),
      });

      const excludedPathsInput = await input({
        message: "除外パスをカンマ区切りで入力してください (例: /health, /metrics):",
        default: "/health,/metrics",
      });

      excludedPaths = excludedPathsInput
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      printInfo(
        "ASMはmonitorモードで作成されます（検出のみ、ブロックしません）。" +
        "ブロッキングを有効化するには、Datadogコンソールから手動で変更してください。"
      );
    }

    return { enableWaf, protectionTargets, excludedPaths };
  }

  async execute(
    config: AsmConfig,
    client: unknown
  ): Promise<ExecutionResult> {
    const resources: ResourceRecord[] = [];
    const errors: string[] = [];
    const manualSteps: ManualStep[] = [];

    if (!config.enableWaf) {
      printInfo("WAFルールの作成をスキップしました");
      return { success: true, resources, manualSteps, errors };
    }

    // WAFカスタムルールをmonitorモードで作成
    for (const target of config.protectionTargets) {
      const ruleDef = WAF_RULES[target];
      const ruleName = `${RESOURCE_PREFIX} ASM ${ruleDef.name}`;

      try {
        const resp = await (client as any).security.asm.createApplicationSecurityWafCustomRule({
          body: {
            data: {
              type: "custom_rule",
              attributes: {
                name: ruleName,
                enabled: true,
                blocking: false, // monitorモード（検出のみ、ブロックしない）
                conditions: [
                  {
                    operator: "match_regex" as const,
                    parameters: {
                      inputs: [
                        {
                          address:
                            "server.request.query" as const,
                        },
                      ],
                      list: [ruleDef.conditionValue],
                    },
                  },
                ],
                tags: {
                  type: ruleDef.category as never,
                  category: "attack_attempt" as never,
                },
              },
            },
          },
        });

        const id = resp.data?.id ?? "";
        this.createdResources.push({
          type: "asm_waf_custom_rule",
          id: String(id),
          name: ruleName,
          createdAt: new Date().toISOString(),
        });
        resources.push({
          type: "asm_waf_custom_rule",
          id: String(id),
          name: ruleName,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`WAFルール作成 (monitorモード): ${ruleName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`WAFルール「${ruleName}」作成失敗: ${msg}`);
      }
    }

    // 除外フィルターを作成
    if (config.excludedPaths.length > 0) {
      const filterName = `${RESOURCE_PREFIX} ASM Exclusion Filter`;
      try {
        const resp = await (client as any).security.asm.createApplicationSecurityWafExclusionFilter({
          body: {
            data: {
              type: "exclusion_filter",
              attributes: {
                enabled: true,
                description: `Managed by datadog-connect: exclude paths (${filterName})`,
                pathGlob: config.excludedPaths.join(","),
                scope: [],
                rulesTarget: [],
              },
            },
          },
        });

        const id = resp.data?.id ?? "";
        this.createdResources.push({
          type: "asm_waf_exclusion_filter",
          id: String(id),
          name: filterName,
          createdAt: new Date().toISOString(),
        });
        resources.push({
          type: "asm_waf_exclusion_filter",
          id: String(id),
          name: filterName,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`WAF除外フィルター作成: ${filterName} (${config.excludedPaths.join(", ")})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`WAF除外フィルター作成失敗: ${msg}`);
      }
    }

    // 手順書生成: DD_APPSEC_ENABLED=true 設定手順
    const outputDir = getSecureOutputDir();
    const outputPath = join(outputDir, "asm-appsec-setup.txt");

    const setupContent = generateAsmAppsecSetup(config.excludedPaths);
    writeSecureFile(outputPath, setupContent);
    printManual(`手順書を出力しました: ${outputPath}`);

    manualSteps.push({
      title: "ASM 有効化 (DD_APPSEC_ENABLED)",
      description:
        "各サービスの起動環境変数またはdatadog.yamlに DD_APPSEC_ENABLED=true を設定し、サービスを再起動してください",
      commands: [
        "# 環境変数で設定する場合",
        "export DD_APPSEC_ENABLED=true",
        "",
        "# または datadog.yaml で設定する場合",
        "# appsec_enabled: true",
        "",
        `# 詳細手順: ${outputPath}`,
      ],
      outputFile: outputPath,
    });

    return {
      success: errors.length === 0,
      resources,
      manualSteps,
      errors,
    };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).security.asm.listApplicationSecurityWAFCustomRules();
      const rules = resp.data ?? [];
      const managedRules = rules.filter((r: any) =>
        (r.attributes?.name ?? "").startsWith(RESOURCE_PREFIX)
      );
      const expected = this.createdResources.filter(
        (r) => r.type === "asm_waf_custom_rule"
      ).length;
      const found = managedRules.length;
      checks.push({
        name: "WAFカスタムルール作成確認",
        passed: found >= expected,
        detail: `${found}/${expected} ルールが存在`,
      });
    } catch (err) {
      checks.push({
        name: "WAFカスタムルール確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new AsmModule());
