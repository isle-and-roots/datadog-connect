import { checkbox } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printSuccess } from "../../utils/prompts.js";
import { v1 } from "@datadog/datadog-api-client";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";

const DASHBOARD_PRESETS = [
  {
    id: "infra-overview",
    name: "インフラ概要",
    description: "CPU/Memory/Disk/Network の全体ビュー",
  },
  {
    id: "aws-overview",
    name: "AWS概要",
    description: "EC2/RDS/Lambda/ELB メトリクス",
  },
  {
    id: "k8s-overview",
    name: "Kubernetes概要",
    description: "Pod/Node/Deployment ステータス",
  },
  {
    id: "apm-service",
    name: "APMサービス",
    description: "レイテンシ/エラー率/スループット",
  },
  {
    id: "logs-analytics",
    name: "ログ分析",
    description: "ログボリューム/エラー率/パターン",
  },
];

interface DashboardsConfig extends ModuleConfig {
  presets: string[];
}

class DashboardsModule extends BaseModule {
  readonly id = "dashboards";
  readonly name = "ダッシュボード";
  readonly description = "推奨ダッシュボードを自動作成";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<DashboardsConfig> {
    const presets = await checkbox({
      message: "作成するダッシュボード:",
      choices: DASHBOARD_PRESETS.map((p) => ({
        value: p.id,
        name: `${p.name} — ${p.description}`,
        checked: true,
      })),
    });

    return { presets };
  }

  async execute(config: DashboardsConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const presetId of config.presets) {
      const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
      if (!preset) continue;

      const definition = getDashboardDefinition(presetId);

      try {
        const resp = await client.v1.dashboards.createDashboard({
          body: {
            title: `${RESOURCE_PREFIX} ${preset.name}`,
            description: preset.description,
            layoutType: "ordered",
            widgets: definition.widgets as unknown as v1.Widget[],
            templateVariables: definition.templateVariables as unknown as v1.DashboardTemplateVariable[] | undefined,
          },
        });

        resources.push({
          type: "dashboard",
          id: resp.id ?? "",
          name: `Dashboard: ${preset.name}`,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`ダッシュボード作成: ${preset.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`ダッシュボード「${preset.name}」作成失敗: ${msg}`);
      }
    }

    return { success: errors.length === 0, resources, manualSteps: [], errors };
  }

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.v1.dashboards.listDashboards();
      const managed = (resp.dashboards ?? []).filter((d) =>
        d.title?.startsWith(RESOURCE_PREFIX)
      );
      checks.push({
        name: "ダッシュボード作成確認",
        passed: managed.length >= this.createdResources.length,
        detail: `${managed.length}件のダッシュボード`,
      });
    } catch (err) {
      checks.push({
        name: "ダッシュボード確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

interface DashDef {
  widgets: Array<Record<string, unknown>>;
  templateVariables?: Array<Record<string, unknown>>;
}

function getDashboardDefinition(presetId: string): DashDef {
  const defs: Record<string, DashDef> = {
    "infra-overview": {
      widgets: [
        makeTimeseries("CPU Usage", "avg:system.cpu.user{$host} by {host}"),
        makeTimeseries("Memory Usage", "avg:system.mem.pct_usable{$host} by {host}"),
        makeTimeseries("Disk I/O", "avg:system.io.await{$host} by {host,device}"),
        makeTimeseries("Network Traffic", "avg:system.net.bytes_rcvd{$host} by {host}"),
        makeToplist("Top CPU Hosts", "avg:system.cpu.user{*} by {host}"),
        makeQueryValue("Total Hosts", "count_nonzero(avg:system.cpu.user{*} by {host})"),
      ],
      templateVariables: [{ name: "host", prefix: "host", default: "*" }],
    },
    "aws-overview": {
      widgets: [
        makeTimeseries("EC2 CPU", "avg:aws.ec2.cpuutilization{*} by {name}"),
        makeTimeseries("RDS Connections", "avg:aws.rds.database_connections{*} by {dbinstanceidentifier}"),
        makeTimeseries("Lambda Invocations", "sum:aws.lambda.invocations{*} by {functionname}.as_count()"),
        makeTimeseries("Lambda Errors", "sum:aws.lambda.errors{*} by {functionname}.as_count()"),
        makeTimeseries("ELB Latency", "avg:aws.elb.latency{*} by {loadbalancername}"),
        makeTimeseries("ELB 5xx", "sum:aws.elb.httpcode_backend_5xx{*} by {loadbalancername}.as_count()"),
      ],
    },
    "k8s-overview": {
      widgets: [
        makeTimeseries("Pod CPU", "avg:kubernetes.cpu.usage.total{*} by {pod_name}"),
        makeTimeseries("Pod Memory", "avg:kubernetes.memory.usage{*} by {pod_name}"),
        makeQueryValue("Running Pods", "sum:kubernetes.pods.running{*}"),
        makeQueryValue("Failed Pods", "sum:kubernetes.pods.running{pod_phase:failed}"),
        makeTimeseries("Container Restarts", "sum:kubernetes.containers.restarts{*} by {container_name}.as_count()"),
        makeToplist("Top CPU Pods", "avg:kubernetes.cpu.usage.total{*} by {pod_name}"),
      ],
      templateVariables: [
        { name: "cluster", prefix: "kube_cluster_name", default: "*" },
        { name: "namespace", prefix: "kube_namespace", default: "*" },
      ],
    },
    "apm-service": {
      widgets: [
        makeTimeseries("Request Rate", "sum:trace.http.request.hits{$service,$env} by {service}.as_rate()"),
        makeTimeseries("Error Rate", "sum:trace.http.request.errors{$service,$env} by {service}.as_rate()"),
        makeTimeseries("Latency p99", "p99:trace.http.request.duration{$service,$env} by {service}"),
        makeTimeseries("Latency p50", "p50:trace.http.request.duration{$service,$env} by {service}"),
      ],
      templateVariables: [
        { name: "service", prefix: "service", default: "*" },
        { name: "env", prefix: "env", default: "production" },
      ],
    },
    "logs-analytics": {
      widgets: [
        makeTimeseries("Log Volume", "sum:logs.ingested_events{*}.as_count()"),
        makeTimeseries("Error Logs", "sum:logs.ingested_events{status:error}.as_count()"),
        makeToplist("Top Log Sources", "sum:logs.ingested_events{*} by {source}.as_count()"),
        makeQueryValue("Error Rate", "sum:logs.ingested_events{status:error}.as_count() / sum:logs.ingested_events{*}.as_count() * 100"),
      ],
    },
  };

  return defs[presetId] ?? { widgets: [] };
}

function makeTimeseries(title: string, query: string): Record<string, unknown> {
  return {
    definition: {
      type: "timeseries",
      title,
      requests: [{ q: query, display_type: "line" }],
    },
  };
}

function makeToplist(title: string, query: string): Record<string, unknown> {
  return {
    definition: {
      type: "toplist",
      title,
      requests: [{ q: query }],
    },
  };
}

function makeQueryValue(title: string, query: string): Record<string, unknown> {
  return {
    definition: {
      type: "query_value",
      title,
      requests: [{ q: query }],
      precision: 0,
    },
  };
}

registerModule(new DashboardsModule());
