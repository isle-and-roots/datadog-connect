import { checkbox, confirm, input } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess, printManual, printInfo } from "../../utils/prompts.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { join } from "node:path";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
  ResourceRecord,
  ManualStep,
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── WAF 保護対象 ──
const PROTECTION_TARGETS = [
  { value: "sqli", name: "SQLi検出" },
  { value: "xss", name: "XSS検出" },
  { value: "cmdi", name: "コマンドインジェクション検出" },
  { value: "path_traversal", name: "パストラバーサル検出" },
] as const;

type ProtectionTarget = (typeof PROTECTION_TARGETS)[number]["value"];

// ── WAF ルール定義 ──
interface WafRuleDef {
  name: string;
  category: string;
  conditionInput: string;
  conditionOperator: string;
  conditionValue: string;
}

const WAF_RULES: Record<ProtectionTarget, WafRuleDef> = {
  sqli: {
    name: "SQLi Detection",
    category: "injection",
    conditionInput: "server.request.query",
    conditionOperator: "match_regex",
    conditionValue: "(?i)(union|select|insert|drop|delete|update|exec|cast|convert|char|varchar|nchar|nvarchar|alter|begin|end|fetch|declare|open|cursor|kill|--)",
  },
  xss: {
    name: "XSS Detection",
    category: "xss",
    conditionInput: "server.request.query",
    conditionOperator: "match_regex",
    conditionValue: "(?i)(<script|javascript:|on\\w+=|<iframe|<object|<embed|<link|<meta)",
  },
  cmdi: {
    name: "Command Injection Detection",
    category: "injection",
    conditionInput: "server.request.query",
    conditionOperator: "match_regex",
    conditionValue: "(?i)(\\||;|&&|\\$\\(|`|\\bexec\\b|\\bsystem\\b|\\bpassthru\\b|\\bpopen\\b)",
  },
  path_traversal: {
    name: "Path Traversal Detection",
    category: "lfi",
    conditionInput: "server.request.query",
    conditionOperator: "match_regex",
    conditionValue: "(?i)(\\.\\./|\\.\\.\\\\/|%2e%2e%2f|%252e%252e%252f)",
  },
};

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

  async preflight(client: DatadogClient): Promise<PreflightResult> {
    try {
      await client.security.asm.listApplicationSecurityWAFCustomRules();
      return { available: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, reason: `ASM APIへのアクセスに失敗しました: ${msg}` };
    }
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
    client: DatadogClient
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
        const resp = await client.security.asm.createApplicationSecurityWafCustomRule({
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
        const resp = await client.security.asm.createApplicationSecurityWafExclusionFilter({
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

    const setupContent = generateAppsecSetup(config.excludedPaths);
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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.security.asm.listApplicationSecurityWAFCustomRules();
      const rules = resp.data ?? [];
      const managedRules = rules.filter((r) =>
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

// ── ヘルパー: DD_APPSEC_ENABLED 設定手順生成 ──
function generateAppsecSetup(excludedPaths: string[]): string {
  const excludeSection =
    excludedPaths.length > 0
      ? `\n# 除外パス (設定済み WAF 除外フィルター)\n${excludedPaths.map((p) => `# - ${p}`).join("\n")}\n`
      : "";

  return `# ASM (Application Security Management) 有効化手順
# Generated by datadog-connect

## 概要
ASM は monitor モード（検出のみ）で設定されています。
攻撃を検知しますが、ブロックは行いません。

## 1. 環境変数で有効化する場合

export DD_APPSEC_ENABLED=true

## 2. datadog.yaml で有効化する場合

appsec_enabled: true
${excludeSection}
## 3. Docker / Kubernetes での設定

### Docker
docker run -e DD_APPSEC_ENABLED=true ...

### Kubernetes (環境変数)
env:
  - name: DD_APPSEC_ENABLED
    value: "true"

## 4. 言語別 APM ライブラリの設定

### Node.js (dd-trace)
DD_APPSEC_ENABLED=true node -r dd-trace/init app.js

### Python (ddtrace)
DD_APPSEC_ENABLED=true ddtrace-run python app.py

### Java
java -javaagent:/opt/datadog/dd-java-agent.jar \\
  -Ddd.appsec.enabled=true \\
  -jar app.jar

### Go / Ruby / PHP
# https://docs.datadoghq.com/security/application_security/ を参照

## 5. monitorモードからblockingモードへの変更

Datadog コンソール > Security > Application Security >
WAF Custom Rules から各ルールの "blocking" を有効化してください。
`;
}

registerModule(new AsmModule());
