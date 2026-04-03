import { checkbox } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess, printManual, printInfo } from "../../utils/prompts.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { join } from "node:path";
import {
  CWS_PROTECTION_TARGETS,
  CWS_PRESET_POLICIES,
  generateCwsSystemProbeYaml,
} from "../../knowledge/security-rules.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { McpToolCall, ModulePlan } from "../../orchestrator/mcp-call.js";

const PROTECTION_TARGETS = CWS_PROTECTION_TARGETS as readonly { value: "file_integrity" | "process_exec" | "network_conn"; name: string }[];
const PRESET_POLICIES = CWS_PRESET_POLICIES as readonly { value: "web_server" | "database" | "container_runtime"; name: string }[];

type ProtectionTarget = (typeof PROTECTION_TARGETS)[number]["value"];
type PresetPolicy = (typeof PRESET_POLICIES)[number]["value"];

interface CwsConfig extends ModuleConfig {
  protectionTargets: ProtectionTarget[];
  presetPolicies: PresetPolicy[];
}

class CwsModule extends BaseModule {
  readonly id = "cws";
  readonly name = "CWS (ワークロード保護)";
  readonly description = "Cloud Workload Security によるランタイム脅威検知";
  readonly category = "security" as const;
  readonly dependencies: string[] = [];

  async preflight(client: unknown): Promise<PreflightResult> {
    try {
      await (client as any).security.csmThreats.listCSMThreatsAgentPolicies();
      return { available: true };
    } catch {
      return {
        available: false,
        reason: "CWSはEnterprise以上のプランが必要です",
      };
    }
  }

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as CwsConfig;
    const calls: McpToolCall[] = [];
    const manualSteps = [];

    const protectionTargets = cfg.protectionTargets ?? [];
    const presetPolicies = cfg.presetPolicies ?? [];

    // Create agent policy calls for each selected preset policy
    for (const policy of presetPolicies) {
      const policyName = `${RESOURCE_PREFIX} CWS ${policy}`;
      calls.push({
        tool: "datadog_create_cws_agent_policy",
        parameters: {
          name: policyName,
          description: `Managed by datadog-connect: ${policy} preset`,
          enabled: true,
          host_tags_lists: [],
        },
        description: `CWSエージェントポリシー「${policy}」を作成`,
        rollbackCall: {
          tool: "datadog_delete_cws_agent_policy",
          parameters: { policy_id: "{{created_id}}" },
          description: `CWSエージェントポリシー「${policyName}」を削除`,
        },
      });
    }

    // Manual step: system-probe.yaml configuration
    const yamlContent = generateCwsSystemProbeYaml(protectionTargets);
    manualSteps.push({
      title: "CWS 有効化 (system-probe.yaml)",
      description:
        "各ホストに system-probe.yaml を配置し、Datadog Agent を再起動してください",
      commands: [
        "# 以下の内容を /etc/datadog-agent/system-probe.yaml に配置してください:",
        "",
        yamlContent,
        "",
        "sudo systemctl restart datadog-agent",
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
          tool: "datadog_list_cws_agent_policies",
          parameters: {},
          description: "CWSエージェントポリシー一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<CwsConfig> {
    const protectionTargets = await checkbox<ProtectionTarget>({
      message: "保護対象を選択してください:",
      choices: PROTECTION_TARGETS.map((t) => ({
        value: t.value,
        name: t.name,
        checked: true,
      })),
    });

    const presetPolicies = await checkbox<PresetPolicy>({
      message: "プリセットポリシーを選択してください:",
      choices: PRESET_POLICIES.map((p) => ({
        value: p.value,
        name: p.name,
        checked: false,
      })),
    });

    return { protectionTargets, presetPolicies };
  }

  async execute(
    config: CwsConfig,
    client: unknown
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];
    const manualSteps = [];

    // プリセットポリシーを作成
    for (const policy of config.presetPolicies) {
      const policyName = `${RESOURCE_PREFIX} CWS ${policy}`;
      try {
        const resp = await (client as any).security.csmThreats.createCSMThreatsAgentPolicy({
          body: {
            data: {
              type: "policy",
              attributes: {
                name: policyName,
                description: `Managed by datadog-connect: ${policy} preset`,
                enabled: true,
                hostTagsLists: [],
              },
            },
          },
        });

        const id = resp.data?.id ?? "";
        this.createdResources.push({
          type: "cws_agent_policy",
          id: String(id),
          name: policyName,
          createdAt: new Date().toISOString(),
        });
        resources.push({
          type: "cws_agent_policy",
          id: String(id),
          name: policyName,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`CWSポリシー作成: ${policyName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`CWSポリシー「${policyName}」作成失敗: ${msg}`);
      }
    }

    // 手順書生成: system-probe.yaml の runtime_security_config 設定
    const outputDir = getSecureOutputDir();
    const outputPath = join(outputDir, "cws-system-probe.yaml");

    const targets = config.protectionTargets;
    const yamlContent = generateCwsSystemProbeYaml(targets);

    writeSecureFile(outputPath, yamlContent);
    printManual(`手順書を出力しました: ${outputPath}`);

    printInfo(
      "CWSを有効化するには、各ホストで system-probe.yaml を設定してDatadog Agentを再起動してください"
    );

    manualSteps.push({
      title: "CWS 有効化 (system-probe.yaml)",
      description:
        "各ホストに system-probe.yaml を配置し、Datadog Agent を再起動してください",
      commands: [
        `# 手順書を参照: ${outputPath}`,
        "sudo systemctl restart datadog-agent",
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
      const resp = await (client as any).security.csmThreats.listCSMThreatsAgentPolicies();
      const policies = resp.data ?? [];
      const managedPolicies = policies.filter((p: any) =>
        (p.attributes?.name ?? "").startsWith(RESOURCE_PREFIX)
      );
      const expected = this.createdResources.length;
      const found = managedPolicies.length;
      checks.push({
        name: "CWSポリシー作成確認",
        passed: found >= expected,
        detail: `${found}/${expected} ポリシーが存在`,
      });
    } catch (err) {
      checks.push({
        name: "CWSポリシー確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new CwsModule());
