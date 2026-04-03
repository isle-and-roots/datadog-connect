/**
 * Monitor Packs — pure domain data for Datadog monitor definitions.
 *
 * All monitor definitions are extracted from the monitors module and expressed
 * as plain TypeScript objects with no runtime dependencies.  The data here
 * drives both the interactive wizard and the MCP Harness tools.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Supported Datadog monitor types used within datadog-connect packs. */
export type MonitorType =
  | "metric alert"
  | "query alert"
  | "service check"
  | "log alert";

/** Alert threshold configuration for a single monitor. */
export interface MonitorThresholds {
  critical: number;
  warning?: number;
}

/** Full definition of a single monitor within a pack. */
export interface MonitorDef {
  name: string;
  type: MonitorType;
  query: string;
  /** Japanese-language notification message body (Datadog template var syntax). */
  message: string;
  thresholds: MonitorThresholds;
}

/** A named collection of related monitors. */
export interface MonitorPack {
  /** Machine-readable key (e.g. "infra", "aws"). */
  id: string;
  /** Human-readable Japanese label shown in the selection UI. */
  label: string;
  monitors: MonitorDef[];
}

// ── Infrastructure Pack ────────────────────────────────────────────────────

/** Basic host-level infrastructure monitors (CPU, memory, disk, NTP). */
export const INFRA_PACK: MonitorDef[] = [
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

// ── AWS Pack ───────────────────────────────────────────────────────────────

/** Recommended monitors for core AWS services (EC2, RDS, Lambda, ELB). */
export const AWS_PACK: MonitorDef[] = [
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
    query:
      "avg(last_10m):avg:aws.rds.database_connections{*} by {dbinstanceidentifier} > 100",
    message: "RDS {{dbinstanceidentifier.name}} の接続数が100を超えています",
    thresholds: { critical: 100, warning: 80 },
  },
  {
    name: "RDS Low Storage",
    type: "metric alert",
    query:
      "avg(last_10m):avg:aws.rds.free_storage_space{*} by {dbinstanceidentifier} < 5368709120",
    message: "RDS {{dbinstanceidentifier.name}} の空きストレージが5GB未満です",
    thresholds: { critical: 5368709120 },
  },
  {
    name: "Lambda High Error Rate",
    type: "metric alert",
    query:
      "sum(last_5m):sum:aws.lambda.errors{*} by {functionname}.as_count() > 10",
    message:
      "Lambda {{functionname.name}} のエラー数が5分で10件を超えています",
    thresholds: { critical: 10, warning: 5 },
  },
  {
    name: "Lambda High Duration",
    type: "metric alert",
    query:
      "avg(last_5m):avg:aws.lambda.duration.maximum{*} by {functionname} > 10000",
    message:
      "Lambda {{functionname.name}} の最大実行時間が10秒を超えています",
    thresholds: { critical: 10000, warning: 5000 },
  },
  {
    name: "ELB 5xx Errors",
    type: "metric alert",
    query:
      "sum(last_5m):sum:aws.elb.httpcode_backend_5xx{*} by {loadbalancername}.as_count() > 50",
    message: "ELB {{loadbalancername.name}} で5xxエラーが増加しています",
    thresholds: { critical: 50, warning: 20 },
  },
];

// ── Kubernetes Pack ────────────────────────────────────────────────────────

/** Monitors for Kubernetes cluster health (pods, nodes, deployments). */
export const K8S_PACK: MonitorDef[] = [
  {
    name: "Pod CrashLoopBackOff",
    type: "metric alert",
    query:
      "max(last_5m):max:kubernetes.containers.restarts{*} by {pod_name} > 5",
    message: "Pod {{pod_name.name}} がCrashLoopBackOff状態です",
    thresholds: { critical: 5, warning: 3 },
  },
  {
    name: "Node Not Ready",
    type: "service check",
    query:
      '"kubernetes_state.node.ready".over("*").by("node").last(3).count_by_status()',
    message: "ノード {{node.name}} がNot Ready状態です",
    thresholds: { critical: 2 },
  },
  {
    name: "Deployment Replica Mismatch",
    type: "metric alert",
    query:
      "avg(last_10m):avg:kubernetes_state.deployment.replicas_desired{*} by {deployment} - avg:kubernetes_state.deployment.replicas_available{*} by {deployment} > 0",
    message: "Deployment {{deployment.name}} のレプリカ数が不一致です",
    thresholds: { critical: 0 },
  },
];

// ── APM Pack ───────────────────────────────────────────────────────────────

/** APM (Application Performance Monitoring) monitors: error rate and latency. */
export const APM_PACK: MonitorDef[] = [
  {
    name: "High Error Rate",
    type: "metric alert",
    query:
      "sum(last_5m):sum:trace.http.request.errors{*} by {service}.as_count() / sum:trace.http.request.hits{*} by {service}.as_count() * 100 > 5",
    message: "サービス {{service.name}} のエラー率が5%を超えています",
    thresholds: { critical: 5, warning: 2 },
  },
  {
    name: "High p99 Latency",
    type: "metric alert",
    query:
      "avg(last_5m):p99:trace.http.request.duration{*} by {service} > 5",
    message: "サービス {{service.name}} のp99レイテンシが5秒を超えています",
    thresholds: { critical: 5, warning: 2 },
  },
];

// ── Logs Pack ──────────────────────────────────────────────────────────────

/** Log-based monitors for detecting error spikes. */
export const LOGS_PACK: MonitorDef[] = [
  {
    name: "Error Log Spike",
    type: "log alert",
    query: 'logs("status:error").index("*").rollup("count").last("5m") > 100',
    message: "エラーログが5分で100件を超えています",
    thresholds: { critical: 100, warning: 50 },
  },
];

// ── Cost Pack ──────────────────────────────────────────────────────────────

/** AWS cost alerting monitors. */
export const COST_PACK: MonitorDef[] = [
  {
    name: "Estimated AWS Charges",
    type: "metric alert",
    query: "avg(last_1d):avg:aws.billing.estimated_charges{*} > 1000",
    message: "AWS推定料金が$1,000を超えています",
    thresholds: { critical: 1000, warning: 500 },
  },
];

// ── Pack Registry ──────────────────────────────────────────────────────────

/**
 * All available monitor packs keyed by their ID.
 * Used by the wizard UI and the MCP list-monitors tool.
 */
export const MONITOR_PACKS: Record<string, MonitorPack> = {
  infra: {
    id: "infra",
    label: "インフラ基本 (CPU/Memory/Disk/NTP)",
    monitors: INFRA_PACK,
  },
  aws: {
    id: "aws",
    label: "AWS推奨 (EC2/RDS/Lambda/ELB)",
    monitors: AWS_PACK,
  },
  k8s: {
    id: "k8s",
    label: "Kubernetes (Pod/Node/Deployment)",
    monitors: K8S_PACK,
  },
  apm: {
    id: "apm",
    label: "APM (エラー率/レイテンシ)",
    monitors: APM_PACK,
  },
  logs: {
    id: "logs",
    label: "ログ (エラースパイク)",
    monitors: LOGS_PACK,
  },
  cost: {
    id: "cost",
    label: "コスト (AWS課金)",
    monitors: COST_PACK,
  },
};

/** Ordered list of pack IDs for deterministic UI rendering. */
export const MONITOR_PACK_IDS = Object.keys(MONITOR_PACKS) as Array<
  keyof typeof MONITOR_PACKS
>;
