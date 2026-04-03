import { select, input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { printManual } from "../../utils/prompts.js";
import {
  K8S_DISTROS,
  K8S_INSTALL_METHODS,
  K8S_HELM_REPO_URL,
  K8S_HELM_CHART,
  K8S_OPERATOR_HELM_CHART,
  generateK8sHelmValues,
  generateK8sOperatorCR,
} from "../../knowledge/cloud-configs.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";

const INSTALL_METHODS = K8S_INSTALL_METHODS;

interface K8sConfig extends ModuleConfig {
  distro: string;
  installMethod: string;
  clusterName: string;
  enableApm: boolean;
  enableLogs: boolean;
  enableNpm: boolean;
  enableLiveProcesses: boolean;
  enableOrchestratorExplorer: boolean;
  enableAdmissionController: boolean;
}

class KubernetesModule extends BaseModule {
  readonly id = "kubernetes";
  readonly name = "Kubernetes";
  readonly description = "K8sクラスタにDatadog Agentをデプロイ";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<K8sConfig> {
    const distro = await select({
      message: "Kubernetes ディストリビューション:",
      choices: K8S_DISTROS,
    });

    const installMethod = await select({
      message: "インストール方法:",
      choices: INSTALL_METHODS,
    });

    const clusterName = await input({
      message: "クラスタ名:",
      validate: (v) => v.trim().length > 0 || "クラスタ名を入力してください",
    });

    const enableApm = await confirm({ message: "APMを有効にしますか？", default: true });
    const enableLogs = await confirm({ message: "ログ収集を有効にしますか？", default: true });
    const enableNpm = await confirm({ message: "ネットワーク監視 (NPM) を有効にしますか？", default: false });
    const enableLiveProcesses = await confirm({ message: "Live Processesを有効にしますか？", default: true });
    const enableOrchestratorExplorer = await confirm({ message: "Orchestrator Explorerを有効にしますか？", default: true });
    const enableAdmissionController = await confirm({ message: "Admission Controller (自動計装) を有効にしますか？", default: true });

    return {
      distro, installMethod, clusterName,
      enableApm, enableLogs, enableNpm,
      enableLiveProcesses, enableOrchestratorExplorer, enableAdmissionController,
    };
  }

  plan(config: ModuleConfig): ModulePlan {
    const k8sConfig = config as K8sConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const clusterName = k8sConfig.clusterName ?? "my-cluster";
    const distro = k8sConfig.distro ?? "vanilla";
    const installMethod = k8sConfig.installMethod ?? "helm";
    const flags = {
      enableApm: k8sConfig.enableApm ?? true,
      enableLogs: k8sConfig.enableLogs ?? true,
      enableNpm: k8sConfig.enableNpm ?? false,
      enableLiveProcesses: k8sConfig.enableLiveProcesses ?? true,
      enableOrchestratorExplorer: k8sConfig.enableOrchestratorExplorer ?? true,
      enableAdmissionController: k8sConfig.enableAdmissionController ?? true,
    };

    // Kubernetes setup is mostly manual (kubectl / helm commands on the cluster)
    // No direct Datadog API calls are needed for agent deployment.
    // We do generate the config files and install commands as manual steps.

    const manualSteps = [];

    if (installMethod === "helm") {
      const helmValues = generateK8sHelmValues(clusterName, distro, flags);

      manualSteps.push({
        title: "Kubernetes Secret を作成",
        description: "Datadog API キーと APP キーを Kubernetes Secret として登録します。",
        commands: [
          `kubectl create secret generic datadog-secret \\`,
          `  --from-literal api-key=<YOUR_DD_API_KEY> \\`,
          `  --from-literal app-key=<YOUR_DD_APP_KEY>`,
        ],
      });

      manualSteps.push({
        title: `Helm Chart (${K8S_HELM_CHART}) で Datadog Agent をデプロイ`,
        description:
          `クラスタ: ${clusterName} (${distro}) に Helm でエージェントをデプロイします。`,
        commands: [
          `helm repo add datadog ${K8S_HELM_REPO_URL}`,
          `helm repo update`,
          `helm install datadog-agent ${K8S_HELM_CHART} \\`,
          `  -f datadog-values.yaml \\`,
          `  --set datadog.apiKeyExistingSecret=datadog-secret \\`,
          `  --set datadog.appKeyExistingSecret=datadog-secret`,
        ],
        outputFile: "datadog-values.yaml",
      });

      manualSteps.push({
        title: "Helm values.yaml 内容",
        description: helmValues,
      });
    } else if (installMethod === "operator") {
      const operatorCR = generateK8sOperatorCR(clusterName, flags);

      manualSteps.push({
        title: "Kubernetes Secret を作成",
        description: "Datadog API キーと APP キーを Kubernetes Secret として登録します。",
        commands: [
          `kubectl create secret generic datadog-secret \\`,
          `  --from-literal api-key=<YOUR_DD_API_KEY> \\`,
          `  --from-literal app-key=<YOUR_DD_APP_KEY>`,
        ],
      });

      manualSteps.push({
        title: `Datadog Operator をインストールして DatadogAgent CR を適用`,
        description:
          `クラスタ: ${clusterName} に Datadog Operator を使ってエージェントをデプロイします。`,
        commands: [
          `helm repo add datadog ${K8S_HELM_REPO_URL}`,
          `helm repo update`,
          `helm install datadog-operator ${K8S_OPERATOR_HELM_CHART}`,
          `kubectl apply -f datadog-agent-cr.yaml`,
        ],
        outputFile: "datadog-agent-cr.yaml",
      });

      manualSteps.push({
        title: "DatadogAgent CR 内容",
        description: operatorCR,
      });
    } else {
      // DaemonSet (manual manifest approach)
      manualSteps.push({
        title: "DaemonSet マニフェストの適用",
        description:
          "Datadog ドキュメントから DaemonSet マニフェストをダウンロードして適用します。" +
          "https://docs.datadoghq.com/containers/kubernetes/installation/",
        commands: [
          `kubectl apply -f https://raw.githubusercontent.com/DataDog/datadog-agent/main/Dockerfiles/manifests/agent.yaml`,
        ],
      });
    }

    // Verification: check that agent pods are running
    verificationCalls.push({
      id: "verify_k8s_agent_pods",
      tool: "datadog_list_hosts",
      parameters: {
        filter: `kube_cluster_name:${clusterName}`,
      },
      description: `Datadog でクラスタ ${clusterName} のホスト (Agent Pod) が登録されているか確認`,
    });

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps,
      verificationCalls,
    };
  }

  async execute(config: K8sConfig): Promise<ExecutionResult> {
    const manualSteps = [];
    const outputDir = getSecureOutputDir();

    if (config.installMethod === "helm") {
      const values = generateK8sHelmValues(config.clusterName, config.distro, {
        enableApm: config.enableApm,
        enableLogs: config.enableLogs,
        enableNpm: config.enableNpm,
        enableLiveProcesses: config.enableLiveProcesses,
        enableOrchestratorExplorer: config.enableOrchestratorExplorer,
        enableAdmissionController: config.enableAdmissionController,
      });
      const valuesPath = `${outputDir}/datadog-values.yaml`;
      writeSecureFile(valuesPath, values);

      manualSteps.push({
        title: "Helm Chart でDatadog Agentをデプロイ",
        description: "以下のコマンドでDatadog Agentをクラスタにデプロイしてください。",
        commands: [
          `helm repo add datadog https://helm.datadoghq.com`,
          `helm repo update`,
          `kubectl create secret generic datadog-secret \\`,
          `  --from-literal api-key=<YOUR_DD_API_KEY> \\`,
          `  --from-literal app-key=<YOUR_DD_APP_KEY>`,
          `helm install datadog-agent datadog/datadog \\`,
          `  -f ${valuesPath} \\`,
          `  --set datadog.apiKeyExistingSecret=datadog-secret \\`,
          `  --set datadog.appKeyExistingSecret=datadog-secret`,
        ],
        outputFile: valuesPath,
      });

      printManual(`Helm values: ${valuesPath}`);
    } else if (config.installMethod === "operator") {
      const cr = generateK8sOperatorCR(config.clusterName, {
        enableApm: config.enableApm,
        enableLogs: config.enableLogs,
        enableNpm: config.enableNpm,
        enableLiveProcesses: config.enableLiveProcesses,
        enableOrchestratorExplorer: config.enableOrchestratorExplorer,
        enableAdmissionController: config.enableAdmissionController,
      });
      const crPath = `${outputDir}/datadog-agent-cr.yaml`;
      writeSecureFile(crPath, cr);

      manualSteps.push({
        title: "Datadog Operatorでデプロイ",
        description: "Datadog Operatorをインストールし、DatadogAgent CRをapplyしてください。",
        commands: [
          `helm repo add datadog https://helm.datadoghq.com`,
          `helm install datadog-operator datadog/datadog-operator`,
          `kubectl apply -f ${crPath}`,
        ],
        outputFile: crPath,
      });

      printManual(`Operator CR: ${crPath}`);
    }

    return { success: true, resources: [], manualSteps, errors: [] };
  }

  async verify(_client: unknown): Promise<VerificationResult> {
    return {
      success: true,
      checks: [{
        name: "K8s Agent デプロイ手順出力確認",
        passed: true,
        detail: "kubectl get pods -l app=datadog-agent でPodを確認してください",
      }],
    };
  }
}

registerModule(new KubernetesModule());
