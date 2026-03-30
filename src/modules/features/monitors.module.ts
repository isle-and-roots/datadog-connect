import { checkbox, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptNotification, formatNotificationHandle } from "../shared/notifications.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import type {
  ModuleConfig,
  ExecutionResult,
  VerificationResult,
} from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

// ── Monitor Packs ──
interface MonitorDef {
  name: string;
  type: "metric alert" | "query alert" | "service check" | "log alert";
  query: string;
  message: string;
  thresholds: { critical: number; warning?: number };
}

const INFRA_PACK: MonitorDef[] = [
  {
    name: "Host Not Reporting",
    type: "service check",
    query: '"datadog.agent.up".over("*").by("host").last(2).count_by_status()',
    message: "ホスト {{host.name}} が応答していません",
    thresholds: { critical: 1 },
  },
  {
    name: "High CPU Usage",
    type: "metric alert",
    query: "avg(last_5m):avg:system.cpu.user{*} by {host} > 90",
    message: "ホスト {{host.name}} のCPU使用率が90%を超えています",
    thresholds: { critical: 90, warning: 80 },
  },
  {
    name: "High Memory Usage",
    type: "metric alert",
    query: "avg(last_5m):avg:system.mem.pct_usable{*} by {host} < 10",
    message: "ホスト {{host.name}} のメモリ空き容量が10%未満です",
    thresholds: { critical: 10, warning: 20 },
  },
  {
    name: "Disk Space Low",
    type: "metric alert",
    query: "avg(last_5m):avg:system.disk.in_use{*} by {host,device} > 90",
    message: "ホスト {{host.name}} のディスク使用率が90%を超えています",
    thresholds: { critical: 90, warning: 80 },
  },
  {
    name: "NTP Drift",
    type: "metric alert",
    query: "avg(last_5m):avg:ntp.offset{*} by {host} > 3",
    message: "ホスト {{host.name}} のNTPオフセットが3秒を超えています",
    thresholds: { critical: 3, warning: 1 },
  },
];

const AWS_PACK: MonitorDef[] = [
  {
    name: "EC2 Status Check Failed",
    type: "metric alert",
    query: "max(last_5m):max:aws.ec2.status_check_failed{*} by {name} > 0",
    message: "EC2 {{name.name}} のステータスチェックが失敗しています",
    thresholds: { critical: 0 },
  },
  {
    name: "RDS High Connections",
    type: "metric alert",
    query: "avg(last_10m):avg:aws.rds.database_connections{*} by {dbinstanceidentifier} > 100",
    message: "RDS {{dbinstanceidentifier.name}} の接続数が100を超えています",
    thresholds: { critical: 100, warning: 80 },
  },
  {
    name: "RDS Low Storage",
    type: "metric alert",
    query: "avg(last_10m):avg:aws.rds.free_storage_space{*} by {dbinstanceidentifier} < 5368709120",
    message: "RDS {{dbinstanceidentifier.name}} の空きストレージが5GB未満です",
    thresholds: { critical: 5368709120 },
  },
  {
    name: "Lambda High Error Rate",
    type: "metric alert",
    query: "sum(last_5m):sum:aws.lambda.errors{*} by {functionname}.as_count() > 10",
    message: "Lambda {{functionname.name}} のエラー数が5分で10件を超えています",
    thresholds: { critical: 10, warning: 5 },
  },
  {
    name: "Lambda High Duration",
    type: "metric alert",
    query: "avg(last_5m):avg:aws.lambda.duration.maximum{*} by {functionname} > 10000",
    message: "Lambda {{functionname.name}} の最大実行時間が10秒を超えています",
    thresholds: { critical: 10000, warning: 5000 },
  },
  {
    name: "ELB 5xx Errors",
    type: "metric alert",
    query: "sum(last_5m):sum:aws.elb.httpcode_backend_5xx{*} by {loadbalancername}.as_count() > 50",
    message: "ELB {{loadbalancername.name}} で5xxエラーが増加しています",
    thresholds: { critical: 50, warning: 20 },
  },
];

const K8S_PACK: MonitorDef[] = [
  {
    name: "Pod CrashLoopBackOff",
    type: "metric alert",
    query: "max(last_5m):max:kubernetes.containers.restarts{*} by {pod_name} > 5",
    message: "Pod {{pod_name.name}} がCrashLoopBackOff状態です",
    thresholds: { critical: 5, warning: 3 },
  },
  {
    name: "Node Not Ready",
    type: "service check",
    query: '"kubernetes_state.node.ready".over("*").by("node").last(3).count_by_status()',
    message: "ノード {{node.name}} がNot Ready状態です",
    thresholds: { critical: 2 },
  },
  {
    name: "Deployment Replica Mismatch",
    type: "metric alert",
    query: "avg(last_10m):avg:kubernetes_state.deployment.replicas_desired{*} by {deployment} - avg:kubernetes_state.deployment.replicas_available{*} by {deployment} > 0",
    message: "Deployment {{deployment.name}} のレプリカ数が不一致です",
    thresholds: { critical: 0 },
  },
];

const APM_PACK: MonitorDef[] = [
  {
    name: "High Error Rate",
    type: "metric alert",
    query: "sum(last_5m):sum:trace.http.request.errors{*} by {service}.as_count() / sum:trace.http.request.hits{*} by {service}.as_count() * 100 > 5",
    message: "サービス {{service.name}} のエラー率が5%を超えています",
    thresholds: { critical: 5, warning: 2 },
  },
  {
    name: "High p99 Latency",
    type: "metric alert",
    query: "avg(last_5m):p99:trace.http.request.duration{*} by {service} > 5",
    message: "サービス {{service.name}} のp99レイテンシが5秒を超えています",
    thresholds: { critical: 5, warning: 2 },
  },
];

const LOGS_PACK: MonitorDef[] = [
  {
    name: "Error Log Spike",
    type: "log alert",
    query: 'logs("status:error").index("*").rollup("count").last("5m") > 100',
    message: "エラーログが5分で100件を超えています",
    thresholds: { critical: 100, warning: 50 },
  },
];

const COST_PACK: MonitorDef[] = [
  {
    name: "Estimated AWS Charges",
    type: "metric alert",
    query: "avg(last_1d):avg:aws.billing.estimated_charges{*} > 1000",
    message: "AWS推定料金が$1,000を超えています",
    thresholds: { critical: 1000, warning: 500 },
  },
];

const PACKS: Record<string, { label: string; monitors: MonitorDef[] }> = {
  infra: { label: "インフラ基本 (CPU/Memory/Disk/NTP)", monitors: INFRA_PACK },
  aws: { label: "AWS推奨 (EC2/RDS/Lambda/ELB)", monitors: AWS_PACK },
  k8s: { label: "Kubernetes (Pod/Node/Deployment)", monitors: K8S_PACK },
  apm: { label: "APM (エラー率/レイテンシ)", monitors: APM_PACK },
  logs: { label: "ログ (エラースパイク)", monitors: LOGS_PACK },
  cost: { label: "コスト (AWS課金)", monitors: COST_PACK },
};

interface MonitorsConfig extends ModuleConfig {
  packs: string[];
  useDefaults: boolean;
  notificationHandle: string;
}

class MonitorsModule extends BaseModule {
  readonly id = "monitors";
  readonly name = "モニター/アラート";
  readonly description = "推奨モニターパックを自動作成";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<MonitorsConfig> {
    const packs = await checkbox({
      message: "インストールするモニターパック:",
      choices: Object.entries(PACKS).map(([key, pack]) => ({
        value: key,
        name: `${pack.label} (${pack.monitors.length}件)`,
        checked: true,
      })),
    });

    const useDefaults = await confirm({
      message: "推奨閾値をそのまま使用しますか？",
      default: true,
    });

    const notification = await promptNotification();
    const notificationHandle = formatNotificationHandle(notification);

    return { packs, useDefaults, notificationHandle };
  }

  async execute(
    config: MonitorsConfig,
    client: DatadogClient
  ): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const packId of config.packs) {
      const pack = PACKS[packId];
      if (!pack) continue;

      for (const monDef of pack.monitors) {
        try {
          const resp = await client.v1.monitors.createMonitor({
            body: {
              name: `${RESOURCE_PREFIX} ${monDef.name}`,
              type: monDef.type as "metric alert",
              query: monDef.query,
              message: `${monDef.message}\n\n${config.notificationHandle}`,
              options: {
                thresholds: monDef.thresholds,
                notifyNoData: monDef.type === "service check",
                noDataTimeframe: monDef.type === "service check" ? 10 : undefined,
              },
              tags: [`pack:${packId}`, "managed:datadog-connect"],
            },
          });

          resources.push({
            type: "monitor",
            id: String(resp.id ?? ""),
            name: `${RESOURCE_PREFIX} ${monDef.name}`,
            createdAt: new Date().toISOString(),
          });

          printSuccess(`モニター作成: ${monDef.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`モニター「${monDef.name}」作成失敗: ${msg}`);
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
      const resp = await client.v1.monitors.listMonitors({
        tags: "managed:datadog-connect",
      });
      const count = resp.length;
      const expected = this.createdResources.length;
      checks.push({
        name: "作成モニター数の確認",
        passed: count >= expected,
        detail: `${count}/${expected} モニターが存在`,
      });
    } catch (err) {
      checks.push({
        name: "モニター確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new MonitorsModule());
