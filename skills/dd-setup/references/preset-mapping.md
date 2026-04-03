# Preset Mapping

スタックプロファイルから推奨プリセットとモジュール設定へのマッピング。

## プリセット一覧

| プリセット名 | 対象スタック | 含まれるモジュール数 |
|------------|------------|------------------|
| `web-app-aws` | Node.js/Python + AWS | 8モジュール |
| `web-app-gcp` | Node.js/Python + GCP | 7モジュール |
| `web-app-azure` | Node.js/.NET + Azure | 7モジュール |
| `web-app-paas` | Vercel/Railway/Render | 5モジュール |
| `kubernetes` | K8s (クラウド不問) | 9モジュール |
| `serverless-aws` | Lambda + API Gateway | 6モジュール |
| `java-enterprise` | Java + Spring + SQL DB | 8モジュール |
| `go-microservices` | Go + Docker + K8s | 8モジュール |
| `rails-standard` | Ruby on Rails + PostgreSQL | 6モジュール |
| `security-focused` | CSPM + CWS + SIEM | 5モジュール |
| `minimal` | APM + Logs + 基本モニター | 3モジュール |
| `full` | 全16モジュール | 16モジュール |

---

## 詳細マッピング

### web-app-aws

**対象**: Node.js/Python/Go + Docker/ECS + AWS

```yaml
preset: web-app-aws
modules:
  cloud:
    - name: aws
      config:
        services: [ec2, rds, elasticache, alb, s3, cloudwatch]
        enable_resource_collection: true
  feature:
    - name: apm
      config:
        language: auto-detect  # package.json / requirements.txt から判定
        env: production
        service: auto-detect   # package.json name から取得
    - name: logs
      config:
        source: docker
        service: auto-detect
        pipeline: auto-create
    - name: monitors
      config:
        preset: web-service
        thresholds:
          cpu_critical: 85
          memory_critical: 90
          error_rate_critical: 1.0
          latency_p99_critical: 2000
    - name: dashboards
      config:
        templates: [service-overview, aws-infrastructure]
```

**デフォルトモニター** (12個):
1. CPU 使用率 > 85% (EC2/ECS)
2. メモリ使用率 > 90%
3. HTTP エラーレート > 1%
4. P99 レイテンシ > 2000ms
5. RDS 接続数 > 80%
6. RDS CPU > 75%
7. ALB 5xx エラーレート > 0.5%
8. ElastiCache メモリ > 85%
9. ディスク使用率 > 85%
10. デプロイ検出 (APM deployment tracking)
11. サービス停止検出 (Synthetics)
12. ログエラースパイク検出

---

### web-app-gcp

**対象**: Node.js/Python + Cloud Run/GKE + GCP

```yaml
preset: web-app-gcp
modules:
  cloud:
    - name: gcp
      config:
        services: [compute_engine, cloud_sql, cloud_run, pub_sub, cloud_storage]
        project_id: auto-detect
  feature:
    - name: apm
      config:
        language: auto-detect
        env: production
    - name: logs
      config:
        source: gcp-cloud-logging
    - name: monitors
      config:
        preset: web-service
    - name: dashboards
      config:
        templates: [service-overview, gcp-infrastructure]
```

---

### kubernetes

**対象**: Kubernetes (クラウド不問)

```yaml
preset: kubernetes
modules:
  cloud:
    - name: kubernetes
      config:
        collect_events: true
        node_labels_as_tags: true
        namespace_labels_as_tags: true
  feature:
    - name: apm
      config:
        injection: admission-controller  # K8s Admission Controller 経由
        unified_service_tagging: true
    - name: logs
      config:
        source: kubernetes
        container_collect_all: true
    - name: monitors
      config:
        preset: kubernetes
        templates:
          - node-not-ready
          - pod-crashloopbackoff
          - deployment-replica-mismatch
          - persistent-volume-pending
    - name: dashboards
      config:
        templates: [kubernetes-overview, kubernetes-pods, kubernetes-nodes]
```

**デフォルトモニター** (15個):
1. Node NotReady
2. Pod CrashLoopBackOff
3. OOMKilled Pod
4. Deployment レプリカ不足
5. PersistentVolume Pending
6. API サーバー応答遅延
7. etcd レイテンシ高
8. kubelet ステータス
9. CPU スロットリング > 25%
10. メモリ要求 vs 制限の乖離
11. ネットワーク I/O 異常
12. ディスクプレッシャー
13. イメージプルエラー
14. HPA スケールアップ失敗
15. 証明書期限切れ (90日前)

---

### serverless-aws

**対象**: AWS Lambda + API Gateway / EventBridge

```yaml
preset: serverless-aws
modules:
  cloud:
    - name: aws
      config:
        services: [lambda, api_gateway, step_functions, sqs, sns, dynamodb]
  feature:
    - name: apm
      config:
        lambda_layer: true
        enhanced_metrics: true
    - name: logs
      config:
        source: lambda
        forwarder: datadog-forwarder
    - name: monitors
      config:
        preset: serverless
```

**デフォルトモニター** (8個):
1. Lambda エラーレート > 1%
2. Lambda タイムアウト率 > 0.5%
3. Lambda スロットリング発生
4. Lambda コールドスタート > 10%
5. API Gateway 5xx > 0.5%
6. API Gateway レイテンシ P99 > 3000ms
7. DynamoDB スロットリング
8. SQS デッドレターキュー メッセージ数 > 0

---

### minimal

**対象**: 小規模サービス、試用、PoC

```yaml
preset: minimal
modules:
  feature:
    - name: apm
      config:
        language: auto-detect
    - name: logs
      config:
        source: auto-detect
    - name: monitors
      config:
        templates:
          - high-error-rate
          - service-down
          - high-latency
```

---

## モジュール設定パラメーター

### APM 言語自動検出ロジック

```
package.json 存在 → Node.js
requirements.txt / pyproject.toml → Python
go.mod → Go
pom.xml / build.gradle → Java
Gemfile → Ruby
composer.json → PHP
Cargo.toml → Rust
*.csproj / *.sln → dotnet
```

### ログソース自動検出ロジック

```
Dockerfile 存在 → docker
kubernetes/ 存在 → kubernetes
lambda/ または serverless.yml → lambda
app.yaml (GCP) → gcp-cloud-logging
heroku / render / railway → heroku
その他 → journald (systemd) or file-tail
```

### スレッショルドのデフォルト値

| メトリクス | Warning | Critical |
|-----------|---------|---------|
| CPU 使用率 | 70% | 85% |
| メモリ使用率 | 80% | 90% |
| ディスク使用率 | 75% | 85% |
| HTTP エラーレート | 0.5% | 1% |
| P99 レイテンシ | 1000ms | 2000ms |
| DB 接続数 | 70% | 85% |
