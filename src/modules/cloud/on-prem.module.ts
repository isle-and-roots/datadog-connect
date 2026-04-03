import { select, checkbox, confirm, input } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual } from "../../utils/prompts.js";
import {
  ON_PREM_OS_OPTIONS,
  ON_PREM_CM_TOOLS,
  generateLinuxInstallScript,
  generateWindowsInstallScript,
  generateAgentConfigSnippet,
  generateAnsiblePlaybook,
} from "../../knowledge/cloud-configs.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeSecureFile, writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg } from "../../utils/validators.js";

const OS_OPTIONS = ON_PREM_OS_OPTIONS;
const CM_TOOLS = ON_PREM_CM_TOOLS;

interface OnPremConfig extends ModuleConfig {
  os: string;
  hostCount: number;
  cmTool: string;
  enableProcess: boolean;
  enableNetwork: boolean;
  enableContainer: boolean;
  tags: string[];
}

class OnPremModule extends BaseModule {
  readonly id = "on-prem";
  readonly name = "オンプレミス";
  readonly description = "オンプレサーバーにDatadog Agentをインストール";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<OnPremConfig> {
    const os = await select({
      message: "サーバーOS:",
      choices: OS_OPTIONS,
    });

    const hostCountStr = await input({
      message: "ホスト数 (概算):",
      default: "1",
      validate: (v) => /^\d+$/.test(v) || "数値を入力してください",
    });
    const hostCount = parseInt(hostCountStr, 10);

    const cmTool = await select({
      message: "構成管理ツール:",
      choices: CM_TOOLS,
    });

    const enableProcess = await confirm({
      message: "プロセス監視を有効にしますか？",
      default: true,
    });

    const enableNetwork = await confirm({
      message: "ネットワーク監視 (NPM) を有効にしますか？",
      default: false,
    });

    const enableContainer = await confirm({
      message: "コンテナ監視 (Docker/containerd) を有効にしますか？",
      default: false,
    });

    const tags = await promptTags();

    return { os, hostCount, cmTool, enableProcess, enableNetwork, enableContainer, tags };
  }

  plan(config: ModuleConfig): ModulePlan {
    const onPremConfig = config as OnPremConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const os = onPremConfig.os ?? "ubuntu";
    const hostCount = onPremConfig.hostCount ?? 1;
    const cmTool = onPremConfig.cmTool ?? "none";
    const tags = onPremConfig.tags ?? [];
    const flags = {
      enableProcess: onPremConfig.enableProcess ?? true,
      enableNetwork: onPremConfig.enableNetwork ?? false,
      enableContainer: onPremConfig.enableContainer ?? false,
    };

    // On-premises setup is entirely manual (install agent on physical/VM servers)
    const manualSteps = [];

    // Agent install script
    if (os === "windows") {
      const installScript = generateWindowsInstallScript(tags);
      manualSteps.push({
        title: `Datadog Agent インストール (Windows) — ${hostCount} 台`,
        description:
          "PowerShell を管理者権限で実行して Datadog Agent をインストールしてください。" +
          "<YOUR_DD_API_KEY> を実際の API キーに置き換えてください。",
        commands: [
          `# PowerShell (Administrator) で実行`,
          `Set-ExecutionPolicy Bypass -Scope Process`,
          `. agent-install-windows.ps1`,
        ],
        outputFile: "agent-install-windows.ps1",
      });
      manualSteps.push({
        title: "Windows インストールスクリプト内容",
        description: installScript,
      });
    } else {
      const installScript = generateLinuxInstallScript(os, tags, flags);
      manualSteps.push({
        title: `Datadog Agent インストール (${os}) — ${hostCount} 台`,
        description:
          "以下のスクリプトを各ホストで root 権限で実行してください。" +
          "<YOUR_DD_API_KEY> を実際の API キーに置き換えてください。",
        commands: [
          `chmod +x agent-install-${os}.sh`,
          `sudo ./agent-install-${os}.sh`,
        ],
        outputFile: `agent-install-${os}.sh`,
      });
      manualSteps.push({
        title: `Linux インストールスクリプト内容 (${os})`,
        description: installScript,
      });
    }

    // datadog.yaml config snippet
    const configSnippet = generateAgentConfigSnippet(tags, flags);
    manualSteps.push({
      title: "Agent 設定スニペット (datadog.yaml)",
      description:
        "以下の設定を /etc/datadog-agent/datadog.yaml に追記してください。",
      outputFile: "datadog.yaml.snippet",
    });
    manualSteps.push({
      title: "datadog.yaml スニペット内容",
      description: configSnippet,
    });

    // CM tool automation
    if (cmTool === "ansible") {
      const playbook = generateAnsiblePlaybook(tags, flags);
      manualSteps.push({
        title: "Ansible で一括デプロイ",
        description:
          "Ansible の datadog.datadog ロールを使って複数ホストに一括デプロイします。",
        commands: [
          `ansible-galaxy install datadog.datadog`,
          `ansible-playbook -i inventory.ini ansible-datadog.yml \\`,
          `  --extra-vars "datadog_api_key=<YOUR_DD_API_KEY>"`,
        ],
        outputFile: "ansible-datadog.yml",
      });
      manualSteps.push({
        title: "Ansible Playbook 内容",
        description: playbook,
      });
    } else if (cmTool !== "none") {
      manualSteps.push({
        title: `${cmTool} を使ったデプロイ`,
        description:
          `${cmTool} の Datadog モジュール/レシピを使用してください。` +
          "詳細: https://docs.datadoghq.com/agent/basic_agent_usage/",
      });
    }

    // Verification: check hosts appear in Datadog after agent install
    if (tags.length > 0) {
      verificationCalls.push({
        id: "verify_on_prem_hosts",
        tool: "datadog_list_hosts",
        parameters: {
          filter: tags[0],
        },
        description: `Datadog でタグ "${tags[0]}" を持つホストが登録されているか確認`,
      });
    } else {
      verificationCalls.push({
        id: "verify_on_prem_hosts",
        tool: "datadog_list_hosts",
        parameters: {},
        description: "Datadog にホストが登録されているか確認",
      });
    }

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps,
      verificationCalls,
    };
  }

  async execute(config: OnPremConfig): Promise<ExecutionResult> {
    const manualSteps = [];
    const outputDir = getSecureOutputDir();

    // Agent install script
    const flags = { enableProcess: config.enableProcess, enableNetwork: config.enableNetwork, enableContainer: config.enableContainer };
    const installScript = config.os === "windows"
      ? generateWindowsInstallScript(config.tags)
      : generateLinuxInstallScript(config.os, config.tags, flags);
    const installPath = `${outputDir}/agent-install-${config.os}.sh`;
    writeExecutableFile(installPath, installScript);

    manualSteps.push({
      title: `Datadog Agent インストール (${config.os})`,
      description: `${config.hostCount}台のホストに以下のスクリプトを実行してください。`,
      commands: [`chmod +x ${installPath}`, `./${installPath}`],
      outputFile: installPath,
    });

    // datadog.yaml config
    const agentConfig = generateAgentConfigSnippet(config.tags, flags);
    const configPath = `${outputDir}/datadog.yaml.snippet`;
    writeSecureFile(configPath, agentConfig);

    manualSteps.push({
      title: "Agent設定ファイル (datadog.yaml)",
      description: "以下の設定を /etc/datadog-agent/datadog.yaml に追記してください。",
      outputFile: configPath,
    });

    // CM tool recipe
    if (config.cmTool !== "none") {
      const cmScript = config.cmTool === "ansible"
        ? generateAnsiblePlaybook(config.tags, flags)
        : generateLinuxInstallScript(config.os, config.tags, flags);
      const cmPath = `${outputDir}/${config.cmTool}-datadog.${config.cmTool === "ansible" ? "yml" : "rb"}`;
      writeSecureFile(cmPath, cmScript);

      manualSteps.push({
        title: `${config.cmTool} レシピ`,
        description: `${config.cmTool} で一括デプロイする場合はこのファイルを使用してください。`,
        outputFile: cmPath,
      });
    }

    printManual(`インストールスクリプト: ${installPath}`);

    return { success: true, resources: [], manualSteps, errors: [] };
  }

  async verify(_client: unknown): Promise<VerificationResult> {
    return {
      success: true,
      checks: [
        {
          name: "インストールスクリプト出力確認",
          passed: true,
          detail: "手動インストール後にホストがDatadog UIに表示されることを確認してください",
        },
      ],
    };
  }
}

registerModule(new OnPremModule());
