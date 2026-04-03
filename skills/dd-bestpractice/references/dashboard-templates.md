# Dashboard Templates

ユースケース別のダッシュボード設定テンプレート集。

## テンプレート一覧

| テンプレート名 | 用途 | ウィジェット数 |
|-------------|------|-------------|
| `service-overview` | サービス全体の概要 (SLO/エラーレート/レイテンシ) | 12 |
| `infrastructure` | インフラリソース (CPU/メモリ/ディスク) | 10 |
| `database` | DB パフォーマンス (接続数/クエリ時間/レプリケーション) | 8 |
| `kubernetes` | K8s クラスター状態 | 14 |
| `aws-overview` | AWS サービス概要 | 10 |
| `business-kpis` | ビジネス指標 (登録数/決済/アクティブユーザー) | 6 |
| `slo-dashboard` | SLO 達成率・エラーバジェット | 8 |
| `on-call` | オンコール向け (重要アラートのみ) | 6 |

---

## service-overview テンプレート

```json
{
  "title": "{{service_name}} — Service Overview",
  "description": "サービス全体の健全性を一画面で確認",
  "layout_type": "ordered",
  "widgets": [
    {
      "type": "note",
      "content": "## Service Health",
      "background_color": "gray"
    },
    {
      "type": "query_value",
      "title": "Error Rate (5m)",
      "query": "sum(last_5m):sum:trace.http.request.errors{service:{{service_name}},env:production}.as_rate() / sum:trace.http.request.hits{service:{{service_name}},env:production}.as_rate()",
      "precision": 2,
      "unit": "%",
      "conditional_formats": [
        {"comparator": ">", "value": 0.01, "palette": "red_on_white"},
        {"comparator": ">", "value": 0.005, "palette": "yellow_on_white"},
        {"comparator": "<=", "value": 0.005, "palette": "green_on_white"}
      ]
    },
    {
      "type": "timeseries",
      "title": "Request Rate & Error Rate",
      "requests": [
        {
          "q": "sum:trace.http.request.hits{service:{{service_name}},env:production}.as_rate()",
          "display_type": "bars",
          "style": {"palette": "blue"}
        },
        {
          "q": "sum:trace.http.request.errors{service:{{service_name}},env:production}.as_rate()",
          "display_type": "bars",
          "style": {"palette": "warm"}
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "Latency (P50/P95/P99)",
      "requests": [
        {"q": "p50:trace.http.request{service:{{service_name}},env:production}", "display_type": "line"},
        {"q": "p95:trace.http.request{service:{{service_name}},env:production}", "display_type": "line"},
        {"q": "p99:trace.http.request{service:{{service_name}},env:production}", "display_type": "line"}
      ]
    },
    {
      "type": "toplist",
      "title": "Top Slow Endpoints (P99)",
      "requests": [
        {"q": "top(avg:trace.http.request{service:{{service_name}},env:production} by {resource_name}, 10, 'p99', 'desc')"}
      ]
    },
    {
      "type": "toplist",
      "title": "Top Error Endpoints",
      "requests": [
        {"q": "top(sum:trace.http.request.errors{service:{{service_name}},env:production} by {resource_name}, 10, 'sum', 'desc')"}
      ]
    },
    {
      "type": "alert_graph",
      "title": "Active Monitors",
      "alert_id": "all",
      "viz_type": "timeseries"
    }
  ],
  "template_variables": [
    {"name": "service_name", "default": "*", "prefix": "service"},
    {"name": "env", "default": "production", "prefix": "env"}
  ]
}
```

---

## slo-dashboard テンプレート

```json
{
  "title": "SLO Dashboard — {{service_name}}",
  "description": "SLO 達成率とエラーバジェット残量",
  "widgets": [
    {
      "type": "slo",
      "title": "Availability SLO (99.9%)",
      "slo_id": "{{availability_slo_id}}",
      "time_windows": ["7d", "30d"],
      "show_error_budget": true
    },
    {
      "type": "slo",
      "title": "Latency SLO (P99 < 2s)",
      "slo_id": "{{latency_slo_id}}",
      "time_windows": ["7d", "30d"],
      "show_error_budget": true
    },
    {
      "type": "timeseries",
      "title": "Error Budget Burn Rate",
      "requests": [
        {"q": "sum:slo.error_budget_remaining{slo:{{availability_slo_id}}}", "display_type": "area"}
      ]
    },
    {
      "type": "alert_value",
      "title": "Incidents This Month",
      "query": "events('status:error env:production').rollup('count').last('30d')"
    }
  ]
}
```

---

## on-call テンプレート

```json
{
  "title": "On-Call Dashboard — {{team}}",
  "description": "オンコール担当者向け: 重要アラートと主要メトリクスのみ",
  "widgets": [
    {
      "type": "manage_status",
      "title": "Active Critical Alerts",
      "summary_type": "alerts",
      "sort": "status,asc",
      "count": 50,
      "start": 0,
      "display_format": "countsAndList",
      "color_preference": "text",
      "hide_zero_counts": true,
      "show_last_triggered": true,
      "query": "tag:(env:production) status:(Alert OR Warn)"
    },
    {
      "type": "timeseries",
      "title": "Service Error Rate (all services)",
      "requests": [
        {"q": "sum:trace.http.request.errors{env:production} by {service}.as_rate() / sum:trace.http.request.hits{env:production} by {service}.as_rate()"}
      ]
    },
    {
      "type": "event_stream",
      "title": "Recent Deployments & Events",
      "query": "sources:deploy OR sources:kubernetes OR status:error",
      "event_size": "s",
      "tags_execution": "and"
    }
  ]
}
```

---

## database テンプレート

```json
{
  "title": "Database Performance — {{db_type}}",
  "description": "データベースパフォーマンスの総合ビュー",
  "widgets": [
    {
      "type": "timeseries",
      "title": "Active Connections",
      "requests": [
        {"q": "avg:postgresql.connections{env:production}", "display_type": "line"}
      ]
    },
    {
      "type": "timeseries",
      "title": "Query Duration (avg)",
      "requests": [
        {"q": "avg:postgresql.bgwriter.maxwritten_clean{env:production}", "display_type": "line"}
      ]
    },
    {
      "type": "query_value",
      "title": "Cache Hit Rate",
      "query": "avg(last_5m):avg:postgresql.buffer_hit_ratio{env:production}",
      "precision": 2,
      "unit": "%",
      "conditional_formats": [
        {"comparator": "<", "value": 0.9, "palette": "red_on_white"},
        {"comparator": "<", "value": 0.95, "palette": "yellow_on_white"},
        {"comparator": ">=", "value": 0.95, "palette": "green_on_white"}
      ]
    },
    {
      "type": "timeseries",
      "title": "Deadlocks & Conflicts",
      "requests": [
        {"q": "sum:postgresql.deadlocks{env:production}.as_count()", "display_type": "bars"}
      ]
    }
  ]
}
```

---

## SLO 定義の推奨値

| SLO 名 | メトリクス | 目標値 | 測定期間 |
|--------|----------|--------|---------|
| Availability | HTTP 成功率 (2xx/3xx) | 99.9% | 30日 |
| Latency | P99 < 2000ms の割合 | 95% | 7日 |
| Error Rate | エラーレート < 1% | 99% | 30日 |
| Throughput | リクエスト処理完了率 | 99.5% | 30日 |

## テンプレート変数の設定

各テンプレートで使用する変数:

| 変数 | 説明 | 例 |
|-----|------|-----|
| `{{service_name}}` | サービス名 (APM service タグ) | `api-server` |
| `{{env}}` | 環境 | `production` |
| `{{team}}` | チーム名 | `backend-team` |
| `{{db_type}}` | DB 種別 | `postgresql` |
| `{{availability_slo_id}}` | 可用性 SLO の ID | Datadog SLO 作成後に取得 |
