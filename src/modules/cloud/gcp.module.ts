import { input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual, printInfo } from "../../utils/prompts.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";
import { writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg, validateGcpProjectId } from "../../utils/validators.js";
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
          } catch {
            // ブラウザ操作失敗
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
        if (!v.includes("@") || !v.includes(".iam.gserviceaccount.com"))
          return "形式: name@project.iam.gserviceaccount.com";
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

  async execute(config: GcpConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    try {
      await client.v2.gcp.createGCPSTSAccount({
        body: {
          data: {
            type: "gcp_service_account",
            attributes: {
              clientEmail: config.serviceAccountEmail,
              automute: config.automute,
              additionalProperties: {
                project_id: config.projectId,
              },
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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.v2.gcp.listGCPSTSAccounts();
      const accounts = resp.data ?? [];

      // 作成済みリソースがある場合は projectId で照合
      const targetProjectId = this.createdResources[0]?.id;
      let found: boolean;
      let detail: string;

      if (targetProjectId) {
        found = accounts.some((a) => {
          const account = a as unknown as {
            id?: string;
            attributes?: {
              clientEmail?: string;
              additionalProperties?: { project_id?: string };
            };
          };
          // 複数パターンで照合（API実装に依存しない堅牢な判定）
          return account.id === targetProjectId
            || account.attributes?.additionalProperties?.project_id === targetProjectId
            || account.attributes?.clientEmail?.includes(`@${targetProjectId}.`);
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

# 3. Datadog に Workload Identity Federation を設定
echo "3. Workload Identity Federation を設定中..."
# DatadogのSTS統合はキーレス認証を使用します。
# サービスアカウントキーの生成は不要です。
# Datadog コンソールで GCP 統合設定を確認してください。

echo ""
echo "=== セットアップ完了 ==="
echo "Datadog コンソール (https://app.datadoghq.com/integrations/google-cloud-platform) で"
echo "GCP 統合の設定を確認してください。"
`;
}

registerModule(new GcpModule());
