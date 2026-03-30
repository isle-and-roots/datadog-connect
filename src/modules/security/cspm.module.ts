import { checkbox, confirm, input } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import {
  validateAwsAccountId,
  validateGcpProjectId,
  validateAzureSubscriptionId,
} from "../../utils/validators.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── クラウドプロバイダー ──
const CLOUD_PROVIDERS = [
  { value: "aws", name: "AWS" },
  { value: "gcp", name: "GCP" },
  { value: "azure", name: "Azure" },
] as const;

type CloudProvider = (typeof CLOUD_PROVIDERS)[number]["value"];

// ── スキャン対象 ──
const SCAN_TARGETS = [
  { value: "vulnHostOs", name: "ホスト脆弱性スキャン" },
  { value: "vulnContainersOs", name: "コンテナ脆弱性スキャン" },
  { value: "lambda", name: "Lambda脆弱性スキャン (AWS のみ)" },
] as const;

type ScanTarget = (typeof SCAN_TARGETS)[number]["value"];

interface ProviderAccount {
  provider: CloudProvider;
  accountId: string;
}

interface CspmConfig extends ModuleConfig {
  providers: CloudProvider[];
  accounts: ProviderAccount[];
  scanTargets: ScanTarget[];
  confirmEnable: boolean;
}

class CspmModule extends BaseModule {
  readonly id = "cspm";
  readonly name = "CSPM (クラウドセキュリティ)";
  readonly description = "クラウドアカウントのセキュリティ態勢管理とAgentlessスキャン有効化";
  readonly category = "security" as const;
  readonly dependencies: string[] = [];

  async preflight(client: DatadogClient): Promise<PreflightResult> {
    try {
      await client.security.csmCoverage.getCSMCloudAccountsCoverageAnalysis();
      return { available: true };
    } catch {
      return { available: false, reason: "CSPMはEnterprise以上のプランが必要です" };
    }
  }

  async prompt(): Promise<CspmConfig> {
    const providers = await checkbox<CloudProvider>({
      message: "Agentlessスキャンを有効化するクラウドプロバイダー (スペースで選択):",
      choices: CLOUD_PROVIDERS.map((p) => ({
        value: p.value,
        name: p.name,
        checked: false,
      })),
    });

    if (providers.length === 0) {
      return { providers: [], accounts: [], scanTargets: [], confirmEnable: false };
    }

    // 各プロバイダーのアカウントIDを収集
    const accounts: ProviderAccount[] = [];
    for (const provider of providers) {
      const label =
        provider === "aws"
          ? "AWS Account ID (12桁)"
          : provider === "gcp"
          ? "GCP Project ID"
          : "Azure Subscription ID";

      const validate =
        provider === "aws"
          ? validateAwsAccountId
          : provider === "gcp"
          ? validateGcpProjectId
          : validateAzureSubscriptionId;

      const accountId = await input({
        message: `${label}:`,
        validate,
      });
      accounts.push({ provider, accountId: accountId.trim() });
    }

    const scanTargets = await checkbox<ScanTarget>({
      message: "スキャン対象を選択してください:",
      choices: SCAN_TARGETS.map((t) => ({
        value: t.value,
        name: t.name,
        checked: t.value !== "lambda",
      })),
    });

    const confirmEnable = await confirm({
      message: "選択したアカウントでAgentlessスキャンを有効化しますか？",
      default: true,
    });

    return { providers, accounts, scanTargets, confirmEnable };
  }

  async execute(config: CspmConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    if (!config.confirmEnable) {
      return {
        success: true,
        resources: [],
        manualSteps: [],
        errors: [],
      };
    }

    const vulnHostOs = config.scanTargets.includes("vulnHostOs");
    const vulnContainersOs = config.scanTargets.includes("vulnContainersOs");
    const lambda = config.scanTargets.includes("lambda");

    for (const account of config.accounts) {
      if (account.provider === "aws") {
        try {
          await client.security.agentlessScanning.createAwsScanOptions({
            body: {
              data: {
                id: account.accountId,
                type: "aws_scan_options",
                attributes: {
                  lambda,
                  sensitiveData: false,
                  vulnContainersOs,
                  vulnHostOs,
                },
              },
            },
          });

          const resourceName = `${RESOURCE_PREFIX} CSPM AWS ${account.accountId}`;
          this.createdResources.push({
            type: "cspm_aws_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });
          resources.push({
            type: "cspm_aws_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`AWS Agentlessスキャン有効化: ${account.accountId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`AWS Agentlessスキャン有効化失敗 (${account.accountId}): ${msg}`);
        }
      } else if (account.provider === "gcp") {
        try {
          await client.security.agentlessScanning.createGcpScanOptions({
            body: {
              data: {
                id: account.accountId,
                type: "gcp_scan_options",
                attributes: {
                  vulnContainersOs,
                  vulnHostOs,
                },
              },
            },
          });

          const resourceName = `${RESOURCE_PREFIX} CSPM GCP ${account.accountId}`;
          this.createdResources.push({
            type: "cspm_gcp_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });
          resources.push({
            type: "cspm_gcp_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`GCP Agentlessスキャン有効化: ${account.accountId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`GCP Agentlessスキャン有効化失敗 (${account.accountId}): ${msg}`);
        }
      } else if (account.provider === "azure") {
        try {
          await client.security.agentlessScanning.createAzureScanOptions({
            body: {
              data: {
                id: account.accountId,
                type: "azure_scan_options",
                attributes: {
                  vulnContainersOs,
                  vulnHostOs,
                },
              },
            },
          });

          const resourceName = `${RESOURCE_PREFIX} CSPM Azure ${account.accountId}`;
          this.createdResources.push({
            type: "cspm_azure_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });
          resources.push({
            type: "cspm_azure_scan_options",
            id: account.accountId,
            name: resourceName,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`Azure Agentlessスキャン有効化: ${account.accountId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Azure Agentlessスキャン有効化失敗 (${account.accountId}): ${msg}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      resources,
      manualSteps: [],
      errors,
    };
  }

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.security.csmCoverage.getCSMCloudAccountsCoverageAnalysis();
      const enabled = resp.data != null;
      checks.push({
        name: "CSPMクラウドアカウントカバレッジ確認",
        passed: enabled,
        detail: enabled ? "カバレッジデータを取得しました" : "カバレッジデータが取得できません",
      });
    } catch (err) {
      checks.push({
        name: "CSPMカバレッジ確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new CspmModule());
