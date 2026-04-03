import { input, password, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual } from "../../utils/prompts.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg, validateAzureSubscriptionId } from "../../utils/validators.js";
import {
  AZURE_REQUIRED_ROLE,
  AZURE_INTEGRATION_CONSOLE_URL,
  generateAzureSetupScript,
} from "../../knowledge/cloud-configs.js";
import { getBrowserController } from "../../browser/browser-controller.js";
import { fetchAzureSubscriptionId as fetchAzureSubIdFromBrowser } from "../../browser/cloud-browser.js";

interface AzureConfig extends ModuleConfig {
  tenantName: string;
  clientId: string;
  clientSecret: string;
  subscriptionIds: string[];
  automute: boolean;
  enableCspm: boolean;
  tags: string[];
}

class AzureModule extends BaseModule {
  readonly id = "azure";
  readonly name = "Azure統合";
  readonly description = "AzureテナントとDatadogを接続";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<AzureConfig> {
    const tenantName = await input({
      message: "Azure Tenant Name (ドメイン名):",
      validate: (v) => v.trim().length > 0 || "Tenant Nameを入力してください",
    });

    const clientId = await input({
      message: "Azure Client ID (App Registration):",
      validate: (v) => v.trim().length > 0 || "Client IDを入力してください",
    });

    const clientSecret = await password({
      message: "Azure Client Secret:",
      mask: "*",
    });

    let firstSubscriptionId: string;
    const browserCtrl = getBrowserController();
    if (await browserCtrl.isAvailable()) {
      const useBrowser = await confirm({
        message: "ブラウザで Azure Subscription ID を自動取得しますか？",
        default: true,
      });
      if (useBrowser) {
        const ready = await browserCtrl.ensureBrowser();
        if (ready) {
          let fetched: string | null = null;
          try {
            await browserCtrl.launch();
            fetched = await fetchAzureSubIdFromBrowser(browserCtrl);
          } catch {
            // ブラウザ操作失敗
          } finally {
            await browserCtrl.close();
          }
          if (fetched && validateAzureSubscriptionId(fetched) === true) {
            firstSubscriptionId = fetched;
          } else {
            firstSubscriptionId = await input({
              message: "監視するSubscription ID (1つ目):",
              validate: validateAzureSubscriptionId,
            });
          }
        } else {
          firstSubscriptionId = await input({
            message: "監視するSubscription ID (1つ目):",
            validate: (v) => v.trim().length > 0 || "Subscription IDを入力してください",
          });
        }
      } else {
        firstSubscriptionId = await input({
          message: "監視するSubscription ID (1つ目):",
          validate: (v) => v.trim().length > 0 || "Subscription IDを入力してください",
        });
      }
    } else {
      firstSubscriptionId = await input({
        message: "監視するSubscription ID (1つ目):",
        validate: (v) => v.trim().length > 0 || "Subscription IDを入力してください",
      });
    }

    const additionalSubsRaw = await input({
      message: "追加のSubscription ID (カンマ区切り、不要な場合は空でOK):",
      default: "",
    });
    const additionalIds = additionalSubsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const subscriptionIds = [firstSubscriptionId, ...additionalIds];

    const automute = await confirm({
      message: "VM停止時の自動ミュートを有効にしますか？",
      default: true,
    });

    const enableCspm = await confirm({
      message: "Cloud Security Posture Management (CSPM) を有効にしますか？",
      default: false,
    });

    const tags = await promptTags();

    return { tenantName, clientId, clientSecret, subscriptionIds, automute, enableCspm, tags };
  }

  plan(config: ModuleConfig): ModulePlan {
    const azureConfig = config as AzureConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const tenantName = azureConfig.tenantName ?? "<AZURE_TENANT_NAME>";
    const clientId = azureConfig.clientId ?? "<AZURE_CLIENT_ID>";
    const subscriptionIds = azureConfig.subscriptionIds ?? [];
    const automute = azureConfig.automute ?? true;
    const enableCspm = azureConfig.enableCspm ?? false;
    const tags = azureConfig.tags ?? [];

    // Step 1: Create Azure integration in Datadog
    calls.push({
      id: "create_azure_integration",
      tool: "datadog_create_azure_integration",
      parameters: {
        tenant_name: tenantName,
        client_id: clientId,
        // client_secret is a sensitive value — the user provides it at execution time
        client_secret: "<AZURE_CLIENT_SECRET>",
        automute,
        cspm_enabled: enableCspm,
        host_filters: tags.join(","),
      },
      description: `Azure テナント ${tenantName} の Datadog 統合を作成`,
    });

    // Manual steps: az CLI commands to assign Reader role on each subscription
    const azScript = generateAzureSetupScript(tenantName, clientId, subscriptionIds);
    const manualSteps = [
      {
        title: "Azure App Registration の作成と Reader ロール付与",
        description:
          `App Registration (Client ID: ${clientId}) が未作成の場合は先に作成してください。` +
          `次に、各サブスクリプション (${subscriptionIds.length} 件) に対して` +
          `"${AZURE_REQUIRED_ROLE}" ロールを付与します。`,
        commands: [
          `chmod +x azure-setup.sh`,
          `./azure-setup.sh`,
        ],
        outputFile: "azure-setup.sh",
      },
      {
        title: "Azure セットアップスクリプト内容",
        description: azScript,
      },
      {
        title: "Datadog コンソールでの確認",
        description:
          `${AZURE_INTEGRATION_CONSOLE_URL} で Azure 統合のステータスを確認してください。`,
        commands: [`open ${AZURE_INTEGRATION_CONSOLE_URL}`],
      },
    ];

    // Verification: list Azure integrations
    verificationCalls.push({
      id: "verify_azure_integration",
      tool: "datadog_list_azure_integrations",
      parameters: {},
      description: `Azure 統合一覧を取得してテナント ${tenantName} が登録されているか確認`,
      dependsOn: ["create_azure_integration"],
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

  async execute(config: AzureConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    try {
      await (client as any).v1.azure.createAzureIntegration({
        body: {
          tenantName: config.tenantName,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          automute: config.automute,
          cspmEnabled: config.enableCspm,
          hostFilters: config.tags.join(","),
        },
      });

      resources.push({
        type: "azure_integration",
        id: config.tenantName,
        name: `Azure Tenant ${config.tenantName}`,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Azure統合作成失敗: ${msg}`);
    }

    // Generate az CLI commands for prerequisites
    const azScript = generateAzSetupScript(config);
    const outputDir = getSecureOutputDir();
    const scriptPath = `${outputDir}/azure-setup.sh`;
    writeExecutableFile(scriptPath, azScript);

    manualSteps.push({
      title: "Azure App Registration & ロール付与",
      description: "App Registrationが未作成の場合、以下のスクリプトを実行してください。",
      commands: [`chmod +x ${scriptPath}`, `./${scriptPath}`],
      outputFile: scriptPath,
    });

    printManual(`Azureセットアップスクリプト: ${scriptPath}`);

    return { success: errors.length === 0, resources, manualSteps, errors };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v1.azure.listAzureIntegration();
      const found = resp.some((a: any) => a.tenantName === this.createdResources[0]?.id);
      checks.push({
        name: "Azure統合が登録されている",
        passed: found,
        detail: found ? undefined : "テナントが見つかりません",
      });
    } catch (err) {
      checks.push({
        name: "Azure統合の確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

function generateAzSetupScript(config: AzureConfig): string {
  return `#!/bin/bash
# Datadog Azure Integration Setup (generated by Datadog Connect)
# Tenant: ${config.tenantName}

set -e

echo "=== Azure Datadog統合セットアップ ==="

# 1. App Registration 作成 (既存の場合はスキップ)
echo "1. App Registrationを確認中..."
APP_ID=${escapeShellArg(config.clientId)}

# 2. 各サブスクリプションにReaderロールを付与
echo "2. Readerロールを付与中..."
${config.subscriptionIds
  .map(
    (id) => `az role assignment create \\
  --assignee "\${APP_ID}" \\
  --role "Reader" \\
  --scope "/subscriptions/${escapeShellArg(id)}"`
  )
  .join("\n\n")}

echo ""
echo "=== セットアップ完了 ==="
echo "Datadogでの統合確認をしてください。"
`;
}

registerModule(new AzureModule());
