/**
 * Dashboard Specs — pure domain data for Datadog dashboard definitions.
 *
 * All dashboard widget specs, layout configs, and preset definitions are
 * expressed as plain TypeScript objects with no runtime dependencies.
 * The data here drives both the interactive wizard and the MCP Harness tools.
 */

// ── Widget Builder Types ───────────────────────────────────────────────────

/** A single metric query request inside a widget. */
export interface WidgetRequest {
  q: string;
  display_type?: "line" | "bar" | "area";
}

/** Timeseries widget definition (line/area chart over time). */
export interface TimeseriesWidgetDef {
  type: "timeseries";
  title: string;
  requests: WidgetRequest[];
}

/** Top-list widget definition (ranked bar chart). */
export interface ToplistWidgetDef {
  type: "toplist";
  title: string;
  requests: Array<{ q: string }>;
}

/** Query value (big number) widget definition. */
export interface QueryValueWidgetDef {
  type: "query_value";
  title: string;
  requests: Array<{ q: string }>;
  precision: number;
}

/** Union of all supported widget definition types. */
export type WidgetDef =
  | TimeseriesWidgetDef
  | ToplistWidgetDef
  | QueryValueWidgetDef;

/** Outer widget wrapper as sent to the Datadog API. */
export interface Widget {
  definition: WidgetDef;
}

/** A template variable that scopes dashboard queries. */
export interface TemplateVariable {
  name: string;
  prefix: string;
  default: string;
}

// ── Dashboard Spec Types ───────────────────────────────────────────────────

/** A complete dashboard specification ready for API submission. */
export interface DashboardSpec {
  widgets: Widget[];
  templateVariables?: TemplateVariable[];
}

/** Metadata describing a selectable dashboard preset in the wizard. */
export interface DashboardPreset {
  id: string;
  /** Japanese display name shown in the selection list. */
  name: string;
  /** Japanese description shown alongside the name. */
  description: string;
  /** Full widget and template-variable specification. */
  spec: DashboardSpec;
}

// ── Widget Builder Helpers ─────────────────────────────────────────────────

/** Build a timeseries (line chart) widget. */
export function makeTimeseries(title: string, query: string): Widget {
  return {
    definition: {
      type: "timeseries",
      title,
      requests: [{ q: query, display_type: "line" }],
    },
  };
}

/** Build a top-list (ranked bar chart) widget. */
export function makeToplist(title: string, query: string): Widget {
  return {
    definition: {
      type: "toplist",
      title,
      requests: [{ q: query }],
    },
  };
}

/** Build a query-value (big number) widget. */
export function makeQueryValue(title: string, query: string): Widget {
  return {
    definition: {
      type: "query_value",
      title,
      requests: [{ q: query }],
      precision: 0,
    },
  };
}

// ── Dashboard Preset Definitions ───────────────────────────────────────────

/**
 * Infrastructure overview dashboard.
 * Shows CPU, memory, disk I/O and network for all hosts.
 */
export const INFRA_OVERVIEW_SPEC: DashboardSpec = {
  widgets: [
    makeTimeseries("CPU Usage", "avg:system.cpu.user{$host} by {host}"),
    makeTimeseries(
      "Memory Usage",
      "avg:system.mem.pct_usable{$host} by {host}"
    ),
    makeTimeseries(
      "Disk I/O",
      "avg:system.io.await{$host} by {host,device}"
    ),
    makeTimeseries(
      "Network Traffic",
      "avg:system.net.bytes_rcvd{$host} by {host}"
    ),
    makeToplist("Top CPU Hosts", "avg:system.cpu.user{*} by {host}"),
    makeQueryValue(
      "Total Hosts",
      "count_nonzero(avg:system.cpu.user{*} by {host})"
    ),
  ],
  templateVariables: [{ name: "host", prefix: "host", default: "*" }],
};

/**
 * AWS services overview dashboard.
 * Covers EC2, RDS, Lambda, and ELB metrics.
 */
export const AWS_OVERVIEW_SPEC: DashboardSpec = {
  widgets: [
    makeTimeseries("EC2 CPU", "avg:aws.ec2.cpuutilization{*} by {name}"),
    makeTimeseries(
      "RDS Connections",
      "avg:aws.rds.database_connections{*} by {dbinstanceidentifier}"
    ),
    makeTimeseries(
      "Lambda Invocations",
      "sum:aws.lambda.invocations{*} by {functionname}.as_count()"
    ),
    makeTimeseries(
      "Lambda Errors",
      "sum:aws.lambda.errors{*} by {functionname}.as_count()"
    ),
    makeTimeseries(
      "ELB Latency",
      "avg:aws.elb.latency{*} by {loadbalancername}"
    ),
    makeTimeseries(
      "ELB 5xx",
      "sum:aws.elb.httpcode_backend_5xx{*} by {loadbalancername}.as_count()"
    ),
  ],
};

/**
 * Kubernetes cluster overview dashboard.
 * Shows pod CPU/memory, running/failed pod counts, restarts and top consumers.
 */
export const K8S_OVERVIEW_SPEC: DashboardSpec = {
  widgets: [
    makeTimeseries(
      "Pod CPU",
      "avg:kubernetes.cpu.usage.total{*} by {pod_name}"
    ),
    makeTimeseries(
      "Pod Memory",
      "avg:kubernetes.memory.usage{*} by {pod_name}"
    ),
    makeQueryValue("Running Pods", "sum:kubernetes.pods.running{*}"),
    makeQueryValue(
      "Failed Pods",
      "sum:kubernetes.pods.running{pod_phase:failed}"
    ),
    makeTimeseries(
      "Container Restarts",
      "sum:kubernetes.containers.restarts{*} by {container_name}.as_count()"
    ),
    makeToplist(
      "Top CPU Pods",
      "avg:kubernetes.cpu.usage.total{*} by {pod_name}"
    ),
  ],
  templateVariables: [
    { name: "cluster", prefix: "kube_cluster_name", default: "*" },
    { name: "namespace", prefix: "kube_namespace", default: "*" },
  ],
};

/**
 * APM service dashboard.
 * Displays request rate, error rate, and p50/p99 latency per service.
 */
export const APM_SERVICE_SPEC: DashboardSpec = {
  widgets: [
    makeTimeseries(
      "Request Rate",
      "sum:trace.http.request.hits{$service,$env} by {service}.as_rate()"
    ),
    makeTimeseries(
      "Error Rate",
      "sum:trace.http.request.errors{$service,$env} by {service}.as_rate()"
    ),
    makeTimeseries(
      "Latency p99",
      "p99:trace.http.request.duration{$service,$env} by {service}"
    ),
    makeTimeseries(
      "Latency p50",
      "p50:trace.http.request.duration{$service,$env} by {service}"
    ),
  ],
  templateVariables: [
    { name: "service", prefix: "service", default: "*" },
    { name: "env", prefix: "env", default: "production" },
  ],
};

/**
 * Log analytics dashboard.
 * Shows total log volume, error log volume, top sources, and error rate.
 */
export const LOGS_ANALYTICS_SPEC: DashboardSpec = {
  widgets: [
    makeTimeseries(
      "Log Volume",
      "sum:logs.ingested_events{*}.as_count()"
    ),
    makeTimeseries(
      "Error Logs",
      "sum:logs.ingested_events{status:error}.as_count()"
    ),
    makeToplist(
      "Top Log Sources",
      "sum:logs.ingested_events{*} by {source}.as_count()"
    ),
    makeQueryValue(
      "Error Rate",
      "sum:logs.ingested_events{status:error}.as_count() / sum:logs.ingested_events{*}.as_count() * 100"
    ),
  ],
};

// ── Preset Registry ────────────────────────────────────────────────────────

/**
 * All available dashboard presets, ordered for wizard display.
 * Each preset bundles its metadata with the full widget specification.
 */
export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: "infra-overview",
    name: "インフラ概要",
    description: "CPU/Memory/Disk/Network の全体ビュー",
    spec: INFRA_OVERVIEW_SPEC,
  },
  {
    id: "aws-overview",
    name: "AWS概要",
    description: "EC2/RDS/Lambda/ELB メトリクス",
    spec: AWS_OVERVIEW_SPEC,
  },
  {
    id: "k8s-overview",
    name: "Kubernetes概要",
    description: "Pod/Node/Deployment ステータス",
    spec: K8S_OVERVIEW_SPEC,
  },
  {
    id: "apm-service",
    name: "APMサービス",
    description: "レイテンシ/エラー率/スループット",
    spec: APM_SERVICE_SPEC,
  },
  {
    id: "logs-analytics",
    name: "ログ分析",
    description: "ログボリューム/エラー率/パターン",
    spec: LOGS_ANALYTICS_SPEC,
  },
];

/**
 * Look up a dashboard preset by its ID.
 * Returns undefined when the ID does not exist.
 */
export function getDashboardPreset(id: string): DashboardPreset | undefined {
  return DASHBOARD_PRESETS.find((p) => p.id === id);
}

/**
 * Look up a dashboard spec by preset ID.
 * Returns an empty spec when the ID does not exist.
 */
export function getDashboardSpec(presetId: string): DashboardSpec {
  return getDashboardPreset(presetId)?.spec ?? { widgets: [] };
}
