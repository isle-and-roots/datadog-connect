import { input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual, printInfo } from "../../utils/prompts.js";
import { logDebugError } from "../../utils/error-helpers.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg, validateGcpProjectId } from "../../utils/validators.js";
import {
  GCP_REQUIRED_ROLES,
  generateGcpSetupScript,
} from "../../knowledge/cloud-configs.js";
import { getBrowserController } from "../../browser/browser-controller.js";
import { fetchGcpProjectId as fetchGcpProjectIdFromBrowser } from "../../browser/cloud-browser.js";


interface GcpConfig extends ModuleConfig {
  projectId: string;
  serviceAccountEmail: string;
  automute: boolean;
  tags: string[];
}

class GcpModule extends BaseModule {
  readonly id = "gcp";
  readonly name = "GCP統合";
  readonly description = "GCPプロジェクトとDatadogを接続";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<GcpConfig> {
    let projectId: string;
    const browserCtrl = getBrowserController();
    if (await browserCtrl.isAvailable()) {
      const useBrowser = await confirm({
        message: "ブラウザで GCP Project ID を自動取得しますか？",
        default: true,
      });
      if (useBrowser) {
        const ready = await browserCtrl.ensureBrowser();
        if (ready) {
          let fetched: string | null = null;
          try {
            await browserCtrl.launch();
            fetched = await fetchGcpProjectIdFromBrowser(browserCtrl);
          } catch (err) {
            logDebugError("GCP browser fetch", err);
          } finally {
            await browserCtrl.close();
          }
          // ブラウザ取得値もバリデーション
          if (fetched && validateGcpProjectId(fetched) === true) {
            projectId = fetched;
          } else {
            if (fetched) printInfo("取得した値が不正なため、手動入力に切り替えます。");
            projectId = await input({
              message: "GCP Project ID:",
              validate: validateGcpProjectId,
            });
          }
        } else {
          projectId = await input({
            message: "GCP Project ID:",
            validate: validateGcpProjectId,
          });
        }
      } else {
        projectId = await input({
          message: "GCP Project ID:",
          validate: validateGcpProjectId,
        });
      }
    } else {
      projectId = await input({
        message: "GCP Project ID:",
        validate: validateGcpProjectId,
      });
    }

    const serviceAccountEmail = await input({
      message: "サービスアカウント Email:",
      default: `datadog-integration@${projectId}.iam.gserviceaccount.com`,
      validate: (v) => {
        if (!v.trim()) return "サービスアカウント Email は必須です";
        // RFC準拠の基本チェック + GCP SA形式の検証
        const saPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
        if (!saPattern.test(v))
          return "形式: sa-name@project-id.iam.gserviceaccount.com (英小文字・数字・ハイフン)";
        return true;
      },
    });

    const automute = await confirm({
      message: "GCEインスタンス停止時の自動ミュートを有効にしますか？",
      default: true,
    });

    const tags = await promptTags();

    return { projectId, serviceAccountEmail, automute, tags };
  }

  plan(config: ModuleConfig): ModulePlan {
    const gcpConfig = config as GcpConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const projectId = gcpConfig.projectId ?? "<GCP_PROJECT_ID>";
    const serviceAccountEmail =
      gcpConfig.serviceAccountEmail ??
      `datadog-integration@${projectId}.iam.gserviceaccount.com`;
    const automute = gcpConfig.automute ?? true;
    const tags = gcpConfig.tags ?? [];

    // Step 1: Register GCP STS account in Datadog (Workload Identity Federation / keyless auth)
    calls.push({
      id: "create_gcp_sts_account",
      tool: "datadog_create_gcp_sts_integration",
      parameters: {
        client_email: serviceAccountEmail,
        automute,
        host_filters: tags.length > 0 ? tags : undefined,
      },
      description: `GCP サービスアカウント ${serviceAccountEmail} を Datadog STS 統合として登録`,
    });

    // Manual steps: gcloud commands to create SA and bind IAM roles
    const setupScript = generateGcpSetupScript(projectId, serviceAccountEmail, automute, tags);
    const manualSteps = [
      {
        title: "GCP サービスアカウントを作成・ロール付与",
        description:
          "以下の gcloud コマンドを実行して、Datadog 統合用のサービスアカウントを作成し" +
          `必要な IAM ロール (${GCP_REQUIRED_ROLES.join(", ")}) を付与してください。`,
        commands: [
          `# スクリプトに実行権限を付与してから実行`,
          `chmod +x gcp-setup.sh`,
          `./gcp-setup.sh`,
        ],
        outputFile: "gcp-setup.sh",
      },
      {
        title: "GCP セットアップスクリプト内容",
        description: setupScript,
      },
      {
        title: "Workload Identity Federation (WIF) の設定",
        description:
          "Datadog コンソール (Integrations > Google Cloud Platform) で " +
          "'Add GCP Account' → 'Service Account Impersonation' を選択し、" +
          "表示される Pool 情報を使って WIF を設定してください。",
        commands: [
          `# Datadog コンソールで Pool Provider 情報を取得後に実行`,
          `gcloud iam service-accounts add-iam-policy-binding ${serviceAccountEmail} \\`,
          `  --project=${projectId} \\`,
          `  --role=roles/iam.workloadIdentityUser \\`,
          `  --member="principalSet://iam.googleapis.com/projects/${projectId}/locations/global/workloadIdentityPools/datadog-pool/*"`,
        ],
      },
    ];

    // Verification: list GCP STS accounts
    verificationCalls.push({
      id: "verify_gcp_sts_account",
      tool: "datadog_list_gcp_sts_integrations",
      parameters: {},
      description: `GCP STS 統合一覧を取得して ${projectId} が登録されているか確認`,
      dependsOn: ["create_gcp_sts_account"],
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

  async execute(config: GcpConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    try {
      await (client as any).v2.gcp.createGCPSTSAccount({
        body: {
          data: {
            type: "gcp_service_account",
            attributes: {
              clientEmail: config.serviceAccountEmail,
              automute: config.automute,
              hostFilters: config.tags.length > 0 ? config.tags : undefined,
            },
          },
        },
      });

      resources.push({
        type: "gcp_integration",
        id: config.projectId,
        name: `GCP Project ${config.projectId}`,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`GCP統合作成失敗: ${msg}`);
    }

    // Generate gcloud commands
    const gcloudCommands = generateGcloudCommands(config);
    const outputDir = getSecureOutputDir();
    const scriptPath = `${outputDir}/gcp-setup.sh`;
    writeExecutableFile(scriptPath, gcloudCommands);

    manualSteps.push({
      title: "GCPサービスアカウントを作成・設定",
      description: "以下のgcloudコマンドを実行してサービスアカウントを作成し、必要なロールを付与してください。",
      commands: [
        `chmod +x ${scriptPath}`,
        `./${scriptPath}`,
      ],
      outputFile: scriptPath,
    });

    printManual(`GCPセットアップスクリプト: ${scriptPath}`);

    return { success: errors.length === 0, resources, manualSteps, errors };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v2.gcp.listGCPSTSAccounts();
      const accounts = resp.data ?? [];

      const targetProjectId = this.createdResources[0]?.id;
      let found: boolean;
      let detail: string;

      if (targetProjectId) {
        // clientEmail の @project-id. 部分で照合（API公式フィールド）
        found = accounts.some((a: any) => {
          const attrs = (a as unknown as { attributes?: { clientEmail?: string } }).attributes;
          const email = attrs?.clientEmail ?? "";
          return email.includes(`@${targetProjectId}.iam.gserviceaccount.com`);
        });
        detail = found
          ? `Project ID ${targetProjectId} のアカウントが見つかりました`
          : `Project ID ${targetProjectId} のアカウントが見つかりません`;
      } else {
        found = accounts.length > 0;
        detail = found ? `${accounts.length}件のアカウント` : "アカウントが見つかりません";
      }

      checks.push({
        name: "GCP STS統合が登録されている",
        passed: found,
        detail,
      });
    } catch (err) {
      checks.push({
        name: "GCP統合の確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

function generateGcloudCommands(config: GcpConfig): string {
  const saName = config.serviceAccountEmail.split("@")[0];
  return `#!/bin/bash
# Datadog GCP Integration Setup (generated by Datadog Connect)
# Project: ${config.projectId}

set -e

PROJECT_ID=${escapeShellArg(config.projectId)}
SA_NAME=${escapeShellArg(saName)}
SA_EMAIL=${escapeShellArg(config.serviceAccountEmail)}

echo "=== GCP Datadog統合セットアップ ==="

# 1. サービスアカウント作成
echo "1. サービスアカウントを作成中..."
gcloud iam service-accounts create "\${SA_NAME}" \\
  --project="\${PROJECT_ID}" \\
  --display-name="Datadog Integration" \\
  --description="Service account for Datadog monitoring integration"

# 2. 必要なロールを付与
echo "2. ロールを付与中..."
ROLES=(
  "roles/compute.viewer"
  "roles/monitoring.viewer"
  "roles/cloudasset.viewer"
  "roles/browser"
)

for ROLE in "\${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "\${PROJECT_ID}" \\
    --member="serviceAccount:\${SA_EMAIL}" \\
    --role="\${ROLE}" \\
    --quiet
done

# 3. Workload Identity Federation (WIF) を設定
echo "3. Workload Identity Federation を設定中..."
echo ""
echo "Datadog の STS 統合はキーレス認証（Workload Identity Federation）を使用します。"
echo "サービスアカウントキーの生成は不要です。"
echo ""
echo "--- WIF 設定手順 ---"
echo "1. Datadog コンソールで GCP 統合ページを開く:"
echo "   https://app.datadoghq.com/integrations/google-cloud-platform"
echo ""
echo "2. 'Add GCP Account' → 'Service Account Impersonation' を選択"
echo ""
echo "3. 表示される Datadog の Workload Identity Pool 情報をコピー:"
echo "   - Pool Provider: (Datadog コンソールに表示される値)"
echo "   - Service Account: (上で作成した \${SA_EMAIL})"
echo ""
echo "4. GCP 側で WIF を設定:"
gcloud iam service-accounts add-iam-policy-binding "\${SA_EMAIL}" \\
  --project="\${PROJECT_ID}" \\
  --role="roles/iam.workloadIdentityUser" \\
  --member="principalSet://iam.googleapis.com/projects/\${PROJECT_ID}/locations/global/workloadIdentityPools/datadog-pool/*" \\
  --quiet 2>/dev/null || echo "   ⚠️  WIF バインディングは Datadog コンソールの Pool 情報確定後に手動で実行してください。"
echo ""
echo "=== セットアップ完了 ==="
echo "Datadog コンソール (https://app.datadoghq.com/integrations/google-cloud-platform) で"
echo "GCP 統合の設定を確認してください。"
`;
}

registerModule(new GcpModule());
