# Stack Monitors

スタックコンポーネント別の推奨モニター定義集。

## Web アプリケーション (汎用)

### HTTP / API 層

```yaml
- name: High HTTP 5xx Error Rate
  type: metric
  query: "sum(last_5m):sum:trace.http.request.errors{env:production} / sum:trace.http.request.hits{env:production} > 0.01"
  thresholds:
    critical: 0.01   # 1%
    warning: 0.005   # 0.5%
  tags: [layer:api, tier:critical]

- name: High HTTP P99 Latency
  type: metric
  query: "avg(last_5m):p99:trace.http.request{env:production} > 2000"
  thresholds:
    critical: 2000   # 2s
    warning: 1000    # 1s
  tags: [layer:api, tier:critical]

- name: Service Down (Synthetic)
  type: synthetics
  check: health_check
  url: "https://{{service_url}}/health"
  interval: 60
  tags: [tier:critical]

- name: High Apdex Score Drop
  type: metric
  query: "avg(last_10m):sum:trace.http.request.apdex{env:production} < 0.7"
  thresholds:
    critical: 0.7
    warning: 0.85

- name: Deployment Spike (Error Rate after Deploy)
  type: event_alert
  query: "events('sources:deploy').rollup('count').last('5m') > 0"
  # デプロイ後5分以内にエラーレートが上昇したら通知
```

### Node.js 固有

```yaml
- name: Node.js Heap Memory Growing
  type: metric
  query: "avg(last_30m):derivative(avg:nodejs.heap_size.used{env:production}) > 5242880"
  # 30分間で5MB/分以上増加 → メモリリーク疑い
  thresholds:
    critical: 5242880

- name: Node.js Event Loop Lag
  type: metric
  query: "avg(last_5m):avg:nodejs.event_loop.delay.avg{env:production} > 100"
  thresholds:
    critical: 100   # 100ms
    warning: 50

- name: Node.js GC Pause Time
  type: metric
  query: "avg(last_5m):avg:nodejs.gc.pause_time.avg{env:production} > 500"
  thresholds:
    critical: 500   # 500ms

- name: Uncaught Exception Count
  type: log
  query: "status:error source:nodejs @message:\"UnhandledPromiseRejection\""
  thresholds:
    critical: 5   # 5分間に5件以上
```

### Python 固有

```yaml
- name: Python Unhandled Exception
  type: log
  query: "status:error source:python @message:\"Traceback\""
  thresholds:
    critical: 10

- name: Celery Worker Down
  type: metric
  query: "sum(last_5m):sum:celery.worker.count{env:production} < 1"
  thresholds:
    critical: 1

- name: Celery Task Failure Rate
  type: metric
  query: "sum(last_5m):sum:celery.task.failed{env:production} / sum:celery.task.total{env:production} > 0.05"
  thresholds:
    critical: 0.05
```

---

## インフラ層

### Linux / VM (EC2, GCE, etc.)

```yaml
- name: High CPU Usage
  type: metric
  query: "avg(last_5m):avg:system.cpu.user{env:production} > 85"
  thresholds:
    critical: 85
    warning: 70

- name: High Memory Usage
  type: metric
  query: "avg(last_5m):avg:system.mem.pct_usable{env:production} < 0.1"
  thresholds:
    critical: 0.1   # 10% 残存 = 90% 使用
    warning: 0.2

- name: Disk Usage High
  type: metric
  query: "max(last_5m):max:system.disk.in_use{env:production} > 0.85"
  thresholds:
    critical: 0.85
    warning: 0.75

- name: Disk I/O Wait High
  type: metric
  query: "avg(last_5m):avg:system.cpu.iowait{env:production} > 20"
  thresholds:
    critical: 20
    warning: 10

- name: Network Packet Drop
  type: metric
  query: "sum(last_5m):sum:system.net.packets_in.error{env:production} + sum:system.net.packets_out.error{env:production} > 100"
  thresholds:
    critical: 100
```

### Docker / コンテナ

```yaml
- name: Container Restart Loop
  type: event_alert
  query: "events('sources:docker status:restart').rollup('count').last('5m') > 3"
  thresholds:
    critical: 3

- name: Container OOM Kill
  type: event_alert
  query: "events('sources:docker status:oom').rollup('count').last('5m') > 0"
  thresholds:
    critical: 1

- name: Container CPU Throttling
  type: metric
  query: "avg(last_5m):avg:docker.cpu.throttled{env:production} > 0.25"
  thresholds:
    critical: 0.25
```

### Kubernetes

```yaml
- name: Pod CrashLoopBackOff
  type: event_alert
  query: "events('sources:kubernetes reason:CrashLoopBackOff').rollup('count').last('5m') > 0"
  thresholds:
    critical: 1

- name: Node NotReady
  type: metric
  query: "sum(last_5m):sum:kubernetes.node.status{status:not_ready} > 0"
  thresholds:
    critical: 1

- name: Deployment Replica Mismatch
  type: metric
  query: "sum(last_5m):sum:kubernetes.deployment.replicas_desired{env:production} - sum:kubernetes.deployment.replicas_ready{env:production} > 0"
  thresholds:
    critical: 1
    warning: 0

- name: HPA Max Replicas Reached
  type: metric
  query: "max(last_10m):max:kubernetes.hpa.spec_max_replicas{env:production} - max:kubernetes.hpa.current_replicas{env:production} == 0"
  thresholds:
    critical: 0

- name: PersistentVolume Pending
  type: metric
  query: "sum(last_5m):sum:kubernetes.persistentvolumeclaim.status{phase:pending} > 0"
  thresholds:
    critical: 1
```

---

## データベース層

### PostgreSQL

```yaml
- name: PostgreSQL Connection Pool Near Limit
  type: metric
  query: "avg(last_5m):avg:postgresql.percent_usage_connections{env:production} > 0.8"
  thresholds:
    critical: 0.85
    warning: 0.75

- name: PostgreSQL Deadlock Detected
  type: metric
  query: "sum(last_5m):sum:postgresql.deadlocks{env:production} > 0"
  thresholds:
    critical: 1

- name: PostgreSQL Long Running Query
  type: metric
  query: "max(last_5m):max:postgresql.max_replication_delay{env:production} > 300"
  thresholds:
    critical: 300   # 5分以上

- name: PostgreSQL Replication Lag
  type: metric
  query: "max(last_5m):max:postgresql.replication.delay{env:production} > 60"
  thresholds:
    critical: 60   # 60秒以上

- name: PostgreSQL Cache Hit Rate Drop
  type: metric
  query: "avg(last_10m):avg:postgresql.buffer_hit_ratio{env:production} < 0.95"
  thresholds:
    critical: 0.90
    warning: 0.95
```

### MySQL

```yaml
- name: MySQL Slow Queries High
  type: metric
  query: "avg(last_5m):avg:mysql.performance.slow_queries{env:production} > 10"
  thresholds:
    critical: 10

- name: MySQL Connections Near Limit
  type: metric
  query: "avg(last_5m):avg:mysql.net.connections{env:production} / avg:mysql.performance.max_connections{env:production} > 0.8"
  thresholds:
    critical: 0.85

- name: MySQL Replication Lag
  type: metric
  query: "max(last_5m):max:mysql.replication.seconds_behind_master{env:production} > 30"
  thresholds:
    critical: 30
```

### Redis

```yaml
- name: Redis Memory Near Limit
  type: metric
  query: "avg(last_5m):avg:redis.mem.used{env:production} / avg:redis.mem.maxmemory{env:production} > 0.85"
  thresholds:
    critical: 0.9
    warning: 0.85

- name: Redis Eviction Rate High
  type: metric
  query: "sum(last_5m):sum:redis.keys.evicted{env:production} > 100"
  thresholds:
    critical: 100

- name: Redis Connection Count High
  type: metric
  query: "avg(last_5m):avg:redis.net.clients{env:production} > 1000"
  thresholds:
    critical: 1000

- name: Redis Keyspace Hit Rate Drop
  type: metric
  query: "avg(last_10m):avg:redis.stats.keyspace_hits{env:production} / (avg:redis.stats.keyspace_hits{env:production} + avg:redis.stats.keyspace_misses{env:production}) < 0.9"
  thresholds:
    critical: 0.85
    warning: 0.9
```

### MongoDB

```yaml
- name: MongoDB Connection Pool Exhausted
  type: metric
  query: "avg(last_5m):avg:mongodb.connections.current{env:production} / avg:mongodb.connections.available{env:production} > 0.8"
  thresholds:
    critical: 0.9

- name: MongoDB Replication Lag
  type: metric
  query: "max(last_5m):max:mongodb.replSet.replication_lag{env:production} > 30"
  thresholds:
    critical: 30

- name: MongoDB Operation Time High
  type: metric
  query: "avg(last_5m):avg:mongodb.optime.duration.max{env:production} > 1000"
  thresholds:
    critical: 1000
```

---

## クラウドサービス層

### AWS ECS / Fargate

```yaml
- name: ECS Service CPU High
  type: metric
  query: "avg(last_5m):avg:ecs.fargate.cpu.percent{env:production} > 85"
  thresholds:
    critical: 85

- name: ECS Task Stopped Unexpectedly
  type: event_alert
  query: "events('sources:ecs reason:essential_container_exited').rollup('count').last('5m') > 0"
  thresholds:
    critical: 1

- name: ECS Service Running Task Count Drop
  type: metric
  query: "sum(last_5m):sum:aws.ecs.service.running{env:production} < sum:aws.ecs.service.desired{env:production}"
  thresholds:
    critical: 0
```

### AWS RDS

```yaml
- name: RDS CPU Utilization High
  type: metric
  query: "avg(last_5m):avg:aws.rds.cpuutilization{env:production} > 75"
  thresholds:
    critical: 85
    warning: 75

- name: RDS Free Storage Space Low
  type: metric
  query: "min(last_10m):min:aws.rds.free_storage_space{env:production} < 5368709120"
  # 5GB 未満
  thresholds:
    critical: 5368709120

- name: RDS Replica Lag High
  type: metric
  query: "max(last_5m):max:aws.rds.replica_lag{env:production} > 30"
  thresholds:
    critical: 30
```

### AWS Lambda

```yaml
- name: Lambda Error Rate High
  type: metric
  query: "sum(last_5m):sum:aws.lambda.errors{env:production} / sum:aws.lambda.invocations{env:production} > 0.01"
  thresholds:
    critical: 0.01

- name: Lambda Throttles
  type: metric
  query: "sum(last_5m):sum:aws.lambda.throttles{env:production} > 10"
  thresholds:
    critical: 10

- name: Lambda Duration Near Timeout
  type: metric
  query: "avg(last_5m):max:aws.lambda.duration.maximum{env:production} / max:aws.lambda.timeout{env:production} > 0.9"
  thresholds:
    critical: 0.9
```

---

## ビジネスメトリクス (カスタム)

```yaml
# これらは custom_metrics を通じてアプリ側から送信する

- name: Sign-up Rate Drop
  type: metric
  query: "sum(last_30m):sum:app.signups.count{env:production} < 1"
  # 30分間に1件未満
  thresholds:
    critical: 1

- name: Payment Failure Rate High
  type: metric
  query: "sum(last_10m):sum:app.payment.failure{env:production} / sum:app.payment.total{env:production} > 0.05"
  thresholds:
    critical: 0.05   # 5%
    warning: 0.02

- name: Critical Workflow SLA Breach
  type: metric
  query: "p90(last_30m):histogram:app.workflow.duration{workflow:checkout,env:production} > 5000"
  thresholds:
    critical: 5000   # 5秒
```
