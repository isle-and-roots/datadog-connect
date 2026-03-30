import { checkbox } from "@inquirer/prompts";
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
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── CWS 保護対象 ──
const PROTECTION_TARGETS = [
  { value: "file_integrity", name: "ファイル改竄検知" },
  { value: "process_exec", name: "プロセス実行監視" },
  { value: "network_conn", name: "ネットワーク接続監視" },
] as const;

// ── プリセットポリシー ──
const PRESET_POLICIES = [
  { value: "web_server", name: "Web Server" },
  { value: "database", name: "Database" },
  { value: "container_runtime", name: "Container Runtime" },
] as const;

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

  async preflight(client: DatadogClient): Promise<PreflightResult> {
    try {
      await client.security.csmThreats.listCSMThreatsAgentPolicies();
      return { available: true };
    } catch {
      return {
        available: false,
        reason: "CWSはEnterprise以上のプランが必要です",
      };
    }
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
    client: DatadogClient
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];
    const manualSteps = [];

    // プリセットポリシーを作成
    for (const policy of config.presetPolicies) {
      const policyName = `${RESOURCE_PREFIX} CWS ${policy}`;
      try {
        const resp = await client.security.csmThreats.createCSMThreatsAgentPolicy({
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
    const yamlContent = generateSystemProbeYaml(targets);

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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.security.csmThreats.listCSMThreatsAgentPolicies();
      const policies = resp.data ?? [];
      const managedPolicies = policies.filter((p) =>
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

// ── ヘルパー: system-probe.yaml 生成 ──
function generateSystemProbeYaml(targets: ProtectionTarget[]): string {
  const fileIntegrity = targets.includes("file_integrity");
  const processExec = targets.includes("process_exec");
  const networkConn = targets.includes("network_conn");

  return `# system-probe.yaml — CWS (Cloud Workload Security) 設定
# Generated by datadog-connect
# このファイルを /etc/datadog-agent/system-probe.yaml に配置し、
# Datadog Agent を再起動してください。

runtime_security_config:
  ## CWS 全体の有効化
  enabled: true

  ## ファイル改竄検知
  fim_enabled: ${fileIntegrity}

  ## プロセス実行監視
  ## process_exec は runtime_security_config.enabled=true で自動有効
  # process_exec_enabled: ${processExec}

  ## ネットワーク接続監視
  network:
    enabled: ${networkConn}

  ## ポリシーファイルの配置先 (オプション)
  # policies_dir: /etc/datadog-agent/runtime-security.d/

  ## イベントサーバー設定
  socket: /opt/datadog-agent/run/runtime-security.sock
`;
}

registerModule(new CwsModule());
