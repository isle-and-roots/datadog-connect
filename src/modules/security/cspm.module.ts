import { checkbox, confirm, input } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { logDebugError } from "../../utils/error-helpers.js";
import {
  validateAwsAccountId,
  validateGcpProjectId,
  validateAzureSubscriptionId,
} from "../../utils/validators.js";
import { CSPM_CLOUD_PROVIDERS, CSPM_SCAN_TARGETS } from "../../knowledge/security-rules.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../../config/types.js";
import type { McpToolCall, ModulePlan } from "../../orchestrator/mcp-call.js";

const CLOUD_PROVIDERS = CSPM_CLOUD_PROVIDERS as readonly { value: "aws" | "gcp" | "azure"; name: string }[];
const SCAN_TARGETS = CSPM_SCAN_TARGETS as readonly { value: "vulnHostOs" | "vulnContainersOs" | "lambda"; name: string; defaultChecked: boolean }[];

type CloudProvider = (typeof CLOUD_PROVIDERS)[number]["value"];
type ScanTarget = "vulnHostOs" | "vulnContainersOs" | "lambda";

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

  async preflight(client: unknown): Promise<PreflightResult> {
    try {
      await (client as any).security.csmCoverage.getCSMCloudAccountsCoverageAnalysis();
      return { available: true };
    } catch (err) {
      logDebugError("CSPM preflight", err);
      return { available: false, reason: "CSPMはEnterprise以上のプランが必要です" };
    }
  }

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as CspmConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const accounts = cfg.accounts ?? [];
    const scanTargets = cfg.scanTargets ?? [];

    const vulnHostOs = scanTargets.includes("vulnHostOs");
    const vulnContainersOs = scanTargets.includes("vulnContainersOs");
    const lambda = scanTargets.includes("lambda");

    for (const account of accounts) {
      if (account.provider === "aws") {
        calls.push({
          tool: "datadog_create_aws_agentless_scan_options",
          parameters: {
            account_id: account.accountId,
            vuln_host_os: vulnHostOs,
            vuln_containers_os: vulnContainersOs,
            lambda: lambda,
            sensitive_data: false,
          },
          description: `AWS Agentlessスキャン有効化: ${account.accountId}`,
          rollbackCall: {
            tool: "datadog_delete_aws_agentless_scan_options",
            parameters: { account_id: account.accountId },
            description: `AWS Agentlessスキャン設定削除: ${account.accountId}`,
          },
        });
      } else if (account.provider === "gcp") {
        calls.push({
          tool: "datadog_create_gcp_agentless_scan_options",
          parameters: {
            project_id: account.accountId,
            vuln_host_os: vulnHostOs,
            vuln_containers_os: vulnContainersOs,
          },
          description: `GCP Agentlessスキャン有効化: ${account.accountId}`,
          rollbackCall: {
            tool: "datadog_delete_gcp_agentless_scan_options",
            parameters: { project_id: account.accountId },
            description: `GCP Agentlessスキャン設定削除: ${account.accountId}`,
          },
        });
      } else if (account.provider === "azure") {
        calls.push({
          tool: "datadog_create_azure_agentless_scan_options",
          parameters: {
            subscription_id: account.accountId,
            vuln_host_os: vulnHostOs,
            vuln_containers_os: vulnContainersOs,
          },
          description: `Azure Agentlessスキャン有効化: ${account.accountId}`,
          rollbackCall: {
            tool: "datadog_delete_azure_agentless_scan_options",
            parameters: { subscription_id: account.accountId },
            description: `Azure Agentlessスキャン設定削除: ${account.accountId}`,
          },
        });
      }
    }

    verificationCalls.push({
      tool: "datadog_get_csm_cloud_accounts_coverage",
      parameters: {},
      description: "CSPMクラウドアカウントカバレッジを確認してAgentlessスキャンが有効であることを検証",
    });

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps: [],
      verificationCalls,
    };
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

  async execute(config: CspmConfig, client: unknown): Promise<ExecutionResult> {
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
          await (client as any).security.agentlessScanning.createAwsScanOptions({
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
          await (client as any).security.agentlessScanning.createGcpScanOptions({
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
          await (client as any).security.agentlessScanning.createAzureScanOptions({
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

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).security.csmCoverage.getCSMCloudAccountsCoverageAnalysis();
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
