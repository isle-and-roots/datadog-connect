import { input, checkbox, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { validateAwsAccountId } from "../../utils/validators.js";
import { printManual } from "../../utils/prompts.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { getBrowserController } from "../../browser/browser-controller.js";
import { fetchAwsAccountId as fetchAwsAccountIdFromBrowser } from "../../browser/cloud-browser.js";

const AWS_SERVICES = [
  "ec2", "rds", "elb", "elbv2", "lambda", "s3", "cloudfront",
  "dynamodb", "ecs", "eks", "elasticache", "kinesis", "sqs", "sns",
  "redshift", "apigateway", "route53",
];

const AWS_LOG_SERVICES = [
  "cloudtrail", "vpc-flow-logs", "rds", "lambda", "elb", "s3-access",
  "cloudfront",
];

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
          await browserCtrl.launch();
          const fetched = await fetchAwsAccountIdFromBrowser(browserCtrl);
          await browserCtrl.close();
          if (fetched) {
            accountId = fetched;
          } else {
            // フォールバック: 手動入力
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
      choices: [
        { value: "ap-northeast-1", name: "ap-northeast-1 (Tokyo)", checked: true },
        { value: "us-east-1", name: "us-east-1 (N. Virginia)", checked: true },
        { value: "us-west-2", name: "us-west-2 (Oregon)" },
        { value: "eu-west-1", name: "eu-west-1 (Ireland)" },
        { value: "ap-southeast-1", name: "ap-southeast-1 (Singapore)" },
      ],
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

  async execute(config: AwsConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    // Create AWS integration
    try {
      const resp = await client.v2.aws.createAWSAccount({
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
    const cfnTemplate = generateCfnTemplate(config.accountId);
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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.v2.aws.listAWSAccounts();
      const accounts = resp.data ?? [];
      const found = accounts.some(
        (a) => a.id?.includes(this.createdResources[0]?.id ?? "")
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

function generateCfnTemplate(accountId: string): string {
  return `AWSTemplateFormatVersion: '2010-09-09'
Description: Datadog Integration IAM Role (generated by Datadog Connect)

Parameters:
  ExternalId:
    Type: String
    Description: External ID provided by Datadog
    Default: '${accountId}'

Resources:
  DatadogIntegrationRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: ${RESOURCE_PREFIX}-DatadogIntegrationRole
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: 'arn:aws:iam::464622532012:root'
            Action: 'sts:AssumeRole'
            Condition:
              StringEquals:
                'sts:ExternalId': !Ref ExternalId
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/SecurityAudit'
      Policies:
        - PolicyName: DatadogAWSIntegrationPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - 'apigateway:GET'
                  - 'autoscaling:Describe*'
                  - 'backup:List*'
                  - 'budgets:ViewBudget'
                  - 'cloudfront:GetDistributionConfig'
                  - 'cloudfront:ListDistributions'
                  - 'cloudtrail:DescribeTrails'
                  - 'cloudtrail:GetTrailStatus'
                  - 'cloudtrail:LookupEvents'
                  - 'cloudwatch:Describe*'
                  - 'cloudwatch:Get*'
                  - 'cloudwatch:List*'
                  - 'codedeploy:List*'
                  - 'codedeploy:BatchGet*'
                  - 'directconnect:Describe*'
                  - 'dynamodb:List*'
                  - 'dynamodb:Describe*'
                  - 'ec2:Describe*'
                  - 'ecs:Describe*'
                  - 'ecs:List*'
                  - 'elasticache:Describe*'
                  - 'elasticache:List*'
                  - 'elasticfilesystem:DescribeFileSystems'
                  - 'elasticfilesystem:DescribeTags'
                  - 'elasticloadbalancing:Describe*'
                  - 'elasticmapreduce:List*'
                  - 'elasticmapreduce:Describe*'
                  - 'es:DescribeElasticsearchDomains'
                  - 'es:ListDomainNames'
                  - 'es:ListTags'
                  - 'health:DescribeEvents'
                  - 'health:DescribeEventDetails'
                  - 'health:DescribeAffectedEntities'
                  - 'kinesis:List*'
                  - 'kinesis:Describe*'
                  - 'lambda:GetPolicy'
                  - 'lambda:List*'
                  - 'logs:DeleteSubscriptionFilter'
                  - 'logs:DescribeLogGroups'
                  - 'logs:DescribeLogStreams'
                  - 'logs:DescribeSubscriptionFilters'
                  - 'logs:FilterLogEvents'
                  - 'logs:PutSubscriptionFilter'
                  - 'logs:TestMetricFilter'
                  - 'rds:Describe*'
                  - 'rds:List*'
                  - 'redshift:DescribeClusters'
                  - 'redshift:DescribeLoggingStatus'
                  - 'route53:List*'
                  - 's3:GetBucketLogging'
                  - 's3:GetBucketLocation'
                  - 's3:GetBucketNotification'
                  - 's3:GetBucketTagging'
                  - 's3:ListAllMyBuckets'
                  - 's3:PutBucketNotification'
                  - 'ses:Get*'
                  - 'sns:List*'
                  - 'sns:Publish'
                  - 'sqs:ListQueues'
                  - 'states:ListStateMachines'
                  - 'states:DescribeStateMachine'
                  - 'support:DescribeTrustedAdvisor*'
                  - 'support:RefreshTrustedAdvisorCheck'
                  - 'tag:GetResources'
                  - 'tag:GetTagKeys'
                  - 'tag:GetTagValues'
                  - 'xray:BatchGetTraces'
                  - 'xray:GetTraceSummaries'
                Resource: '*'

Outputs:
  RoleArn:
    Description: The ARN of the Datadog Integration IAM Role
    Value: !GetAtt DatadogIntegrationRole.Arn
`;
}

// Auto-register
registerModule(new AwsModule());
