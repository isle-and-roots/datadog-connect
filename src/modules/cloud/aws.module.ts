import { input, checkbox, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { validateAwsAccountId } from "../../utils/validators.js";
import { printManual } from "../../utils/prompts.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import {
  AWS_SERVICES,
  AWS_LOG_SERVICES,
  AWS_REGIONS,
  AWS_DEFAULT_SERVICES,
  AWS_DEFAULT_LOG_SERVICES,
  generateAwsCfnTemplate,
} from "../../knowledge/cloud-configs.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { getBrowserController } from "../../browser/browser-controller.js";
import { fetchAwsAccountId as fetchAwsAccountIdFromBrowser } from "../../browser/cloud-browser.js";

interface AwsConfig extends ModuleConfig {
  accountId: string;
  regions: string[];
  services: string[];
  enableLogs: boolean;
  logServices: string[];
  enableCost: boolean;
  enableCspm: boolean;
  tags: string[];
}

class AwsModule extends BaseModule {
  readonly id = "aws";
  readonly name = "AWS統合";
  readonly description = "AWSアカウントとDatadogを接続";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<AwsConfig> {
    let accountId: string;
    const browserCtrl = getBrowserController();
    if (await browserCtrl.isAvailable()) {
      const useBrowser = await confirm({
        message: "ブラウザで AWS Account ID を自動取得しますか？",
        default: true,
      });
      if (useBrowser) {
        const ready = await browserCtrl.ensureBrowser();
        if (ready) {
          let fetched: string | null = null;
          try {
            await browserCtrl.launch();
            fetched = await fetchAwsAccountIdFromBrowser(browserCtrl);
          } catch {
            // ブラウザ操作失敗
          } finally {
            await browserCtrl.close();
          }
          if (fetched && validateAwsAccountId(fetched) === true) {
            accountId = fetched;
          } else {
            accountId = await input({ message: "AWS Account ID (12桁):", validate: validateAwsAccountId });
          }
        } else {
          accountId = await input({ message: "AWS Account ID (12桁):", validate: validateAwsAccountId });
        }
      } else {
        accountId = await input({ message: "AWS Account ID (12桁):", validate: validateAwsAccountId });
      }
    } else {
      accountId = await input({ message: "AWS Account ID (12桁):", validate: validateAwsAccountId });
    }

    const regions = await checkbox({
      message: "監視するリージョン:",
      choices: AWS_REGIONS.map((r) => ({ value: r.value, name: r.name, checked: r.defaultChecked })),
    });

    const services = await checkbox({
      message: "メトリクスを収集するAWSサービス:",
      choices: AWS_SERVICES.map((s) => ({
        value: s,
        name: s.toUpperCase(),
        checked: ["ec2", "rds", "elb", "lambda", "s3"].includes(s),
      })),
    });

    const enableLogs = await confirm({
      message: "AWSログ収集を有効にしますか？",
      default: true,
    });

    let logServices: string[] = [];
    if (enableLogs) {
      logServices = await checkbox({
        message: "ログを収集するサービス:",
        choices: AWS_LOG_SERVICES.map((s) => ({
          value: s,
          name: s,
          checked: ["cloudtrail", "vpc-flow-logs"].includes(s),
        })),
      });
    }

    const enableCost = await confirm({
      message: "コスト管理を有効にしますか？",
      default: false,
    });

    const enableCspm = await confirm({
      message: "CSPM (クラウドセキュリティ態勢管理) のリソース収集を有効にしますか？",
      default: false,
    });

    const tags = await promptTags();

    return {
      accountId,
      regions,
      services,
      enableLogs,
      logServices,
      enableCost,
      enableCspm,
      tags,
    };
  }

  plan(config: ModuleConfig): ModulePlan {
    const awsConfig = config as AwsConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const accountId = awsConfig.accountId ?? "<AWS_ACCOUNT_ID>";
    const regions = awsConfig.regions ?? ["ap-northeast-1", "us-east-1"];
    const services = awsConfig.services ?? [...AWS_DEFAULT_SERVICES];
    const enableLogs = awsConfig.enableLogs ?? true;
    const logServices = awsConfig.logServices ?? [...AWS_DEFAULT_LOG_SERVICES];
    const enableCost = awsConfig.enableCost ?? false;
    const enableCspm = awsConfig.enableCspm ?? false;
    const tags = awsConfig.tags ?? [];

    // Step 1: Create AWS integration account in Datadog
    calls.push({
      id: "create_aws_account",
      tool: "datadog_create_aws_integration",
      parameters: {
        aws_account_id: accountId,
        aws_partition: "aws",
        regions_include_only: regions,
        metrics_automute_enabled: true,
        metrics_tag_filters: tags.length > 0
          ? services.map((s) => ({ namespace: `aws:${s}`, tags }))
          : [],
        logs_lambda_forwarder_enabled: enableLogs,
        log_services: logServices,
        cost_enabled: enableCost,
        cspm_resource_collection_enabled: enableCspm,
        role_name: `${RESOURCE_PREFIX}-DatadogIntegrationRole`,
      },
      description: `AWS アカウント ${accountId} の Datadog 統合を作成`,
    });

    // Step 2: Generate CloudFormation template (manual — AWS side)
    const cfnTemplate = generateAwsCfnTemplate(RESOURCE_PREFIX);
    const manualSteps = [
      {
        title: "AWS IAM ロールを作成 (CloudFormation)",
        description:
          "以下の CloudFormation テンプレートを AWS コンソールまたは CLI でデプロイしてください。" +
          "External ID は Datadog コンソール (Integrations > Amazon Web Services) で確認できます。",
        commands: [
          `# テンプレートをファイルに保存してからデプロイ`,
          `aws cloudformation deploy \\`,
          `  --template-body file://aws-iam-role.yaml \\`,
          `  --stack-name DatadogIntegration \\`,
          `  --capabilities CAPABILITY_NAMED_IAM`,
        ],
        outputFile: `aws-iam-role.yaml`,
      },
      {
        title: "CloudFormation テンプレート内容",
        description: cfnTemplate,
      },
    ];

    // Verification: list AWS accounts and confirm the new account appears
    verificationCalls.push({
      id: "verify_aws_account",
      tool: "datadog_list_aws_integrations",
      parameters: {},
      description: `AWS 統合一覧を取得して アカウント ${accountId} が登録されているか確認`,
      dependsOn: ["create_aws_account"],
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

  async execute(config: AwsConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    // Create AWS integration
    try {
      const resp = await (client as any).v2.aws.createAWSAccount({
        body: {
          data: {
            type: "account",
            attributes: {
              awsAccountId: config.accountId,
              awsPartition: "aws",
              awsRegions: {
                includeOnly: config.regions,
              },
              resourcesConfig: {
                cloudSecurityPostureManagementCollection: config.enableCspm,
                extendedCollection: false,
              },
              metricsConfig: {
                automuteEnabled: true,
                tagFilters: config.tags.length > 0
                  ? config.services.map((s) => ({
                      namespace: `aws:${s}`,
                      tags: config.tags,
                    }))
                  : [],
              },
              tracesConfig: {},
              logsConfig: {
                lambdaForwarder: {},
              },
              authConfig: {
                roleName: `${RESOURCE_PREFIX}-DatadogIntegrationRole`,
              },
            },
          },
        },
      });

      const accountData = resp.data;
      resources.push({
        type: "aws_integration",
        id: accountData?.id ?? config.accountId,
        name: `AWS Account ${config.accountId}`,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`AWS統合作成失敗: ${msg}`);
    }

    // Generate CloudFormation template for IAM role
    const cfnTemplate = generateAwsCfnTemplate(RESOURCE_PREFIX);
    const outputDir = getSecureOutputDir();
    const cfnPath = `${outputDir}/aws-iam-role.yaml`;
    writeSecureFile(cfnPath, cfnTemplate);

    manualSteps.push({
      title: "AWS IAMロールを作成",
      description:
        "以下のCloudFormationテンプレートをAWSコンソールまたはCLIでデプロイしてください。",
      commands: [
        `aws cloudformation deploy \\`,
        `  --template-file ${cfnPath} \\`,
        `  --stack-name DatadogIntegration \\`,
        `  --capabilities CAPABILITY_NAMED_IAM`,
      ],
      outputFile: cfnPath,
    });

    printManual(`IAMロール用テンプレート: ${cfnPath}`);

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
      const resp = await (client as any).v2.aws.listAWSAccounts();
      const accounts = resp.data ?? [];
      const found = accounts.some(
        (a: any) => a.id?.includes(this.createdResources[0]?.id ?? "")
      );
      checks.push({
        name: "AWS統合が登録されている",
        passed: found,
        detail: found ? undefined : "アカウントが見つかりません",
      });
    } catch (err) {
      checks.push({
        name: "AWS統合の確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

// Auto-register
registerModule(new AwsModule());
