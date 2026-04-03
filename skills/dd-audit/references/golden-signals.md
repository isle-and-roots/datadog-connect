# Golden Signals

サービスタイプ別のゴールデンシグナル定義と推奨モニター。

## ゴールデンシグナルとは

Google SRE が定義した4つの主要監視指標:
1. **Latency** (レイテンシ) — リクエスト処理時間
2. **Traffic** (トラフィック) — リクエスト量
3. **Errors** (エラー) — エラーレート
4. **Saturation** (飽和度) — リソース使用率

全てのサービスでこの4シグナルをカバーすることが最低要件。

---

## Web API / HTTP サービス

### Latency (レイテンシ)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| P50 レイテンシ | `p50:trace.http.request{service:X}` | Warning: 500ms, Critical: 1000ms |
| P95 レイテンシ | `p95:trace.http.request{service:X}` | Warning: 1000ms, Critical: 2000ms |
| P99 レイテンシ | `p99:trace.http.request{service:X}` | Warning: 2000ms, Critical: 5000ms |

### Traffic (トラフィック)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| リクエストレート急落 | `sum:trace.http.request.hits{service:X}.as_rate()` | 通常値の 50% 未満 (Anomaly) |
| リクエストレート急増 | 同上 | 通常値の 3倍以上 (Anomaly) |

### Errors (エラー)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| HTTP エラーレート | `errors / hits` | Warning: 0.5%, Critical: 1% |
| 5xx エラー数 | `sum:trace.http.request.errors{http.status_code:5*}` | Critical: > 10 件/分 |
| サービス停止 (Synthetic) | HTTPS ヘルスチェック | 失敗2回連続 |
| 4xx エラーレート異常 | `errors{http.status_code:4*} / hits` | Critical: > 5% (急増は攻撃の兆候) |

### Saturation (飽和度)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| CPU 使用率 | `avg:system.cpu.user` | Warning: 70%, Critical: 85% |
| メモリ使用率 | `avg:system.mem.pct_usable` | Warning: 20% 残, Critical: 10% 残 |
| ディスク使用率 | `max:system.disk.in_use` | Warning: 75%, Critical: 85% |
| ネットワーク帯域 | `avg:system.net.bytes_sent + rcvd` | サービス上限の 80% |

---

## バックグラウンドワーカー / キューコンシューマー

### Latency (処理時間)
| モニター | クエリ/説明 | 閾値 |
|---------|-----------|------|
| ジョブ処理時間 | `avg:app.job.duration_ms{queue:X}` | SLA の 80% |
| キュー滞留時間 | `avg:app.job.wait_time_ms{queue:X}` | Warning: 60s, Critical: 300s |

### Traffic (スループット)
| モニター | クエリ/説明 | 閾値 |
|---------|-----------|------|
| ジョブ処理数の急落 | `sum:app.job.processed.count{queue:X}.as_rate()` | Anomaly (通常の 50% 未満) |
| キュー深度の急増 | `max:app.queue.depth{queue:X}` | Warning: 1000, Critical: 5000 |

### Errors (失敗率)
| モニター | クエリ/説明 | 閾値 |
|---------|-----------|------|
| ジョブ失敗率 | `failed / total` | Warning: 1%, Critical: 5% |
| デッドレターキュー | `sum:app.dlq.messages{queue:X}` | Critical: > 0 |
| ワーカープロセス数 | `sum:app.worker.count{queue:X}` | Critical: 0 件 |

### Saturation
| モニター | クエリ/説明 | 閾値 |
|---------|-----------|------|
| キューバックログ | `max:app.queue.depth - app.queue.processing_rate * 60` | Positive → 処理追いつかず |
| ワーカー CPU | `avg:system.cpu.user{role:worker}` | Warning: 70%, Critical: 85% |

---

## データベース (PostgreSQL/MySQL)

### Latency (クエリ時間)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| 平均クエリ時間 | `avg:postgresql.rows_fetched / postgresql.queries` | Warning: 10ms, Critical: 50ms |
| スロークエリ数 | `sum:postgresql.slow_queries` | Warning: 5/分, Critical: 20/分 |

### Traffic (クエリレート)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| クエリレート異常 | `sum:postgresql.queries{env:production}.as_rate()` | Anomaly |
| トランザクション/秒 | `sum:postgresql.transactions{env:production}.as_rate()` | SLA の 120% 超 |

### Errors (エラー)
| モニター | クエリ | 閾値 |
|---------|--------|------|
| デッドロック | `sum:postgresql.deadlocks` | Critical: > 0 |
| ロック待機タイムアウト | `sum:postgresql.lock_timeouts` | Warning: > 5/分 |
| レプリケーション遅延 | `max:postgresql.replication.delay` | Warning: 10s, Critical: 60s |

### Saturation
| モニター | クエリ | 閾値 |
|---------|--------|------|
| 接続数使用率 | `connections / max_connections` | Warning: 75%, Critical: 85% |
| キャッシュヒット率 | `buffer_hit_ratio` | Critical: < 90% |
| ディスク使用率 | `max:postgresql.disk_usage` | Warning: 75%, Critical: 85% |

---

## キャッシュ (Redis)

### Latency
| モニター | クエリ | 閾値 |
|---------|--------|------|
| コマンドレイテンシ | `avg:redis.info.latency` | Warning: 1ms, Critical: 10ms |

### Traffic
| モニター | クエリ | 閾値 |
|---------|--------|------|
| コマンドレート | `sum:redis.net.commands.instantaneous_ops_per_sec` | Anomaly |

### Errors
| モニター | クエリ | 閾値 |
|---------|--------|------|
| キャッシュヒット率 | `hits / (hits + misses)` | Warning: < 95%, Critical: < 85% |
| エビクション数 | `sum:redis.keys.evicted` | Critical: > 100/分 |

### Saturation
| モニター | クエリ | 閾値 |
|---------|--------|------|
| メモリ使用率 | `mem.used / mem.maxmemory` | Warning: 80%, Critical: 90% |
| 接続数 | `avg:redis.net.clients` | Warning: 500, Critical: 1000 |

---

## サービスタイプ別 最小必須モニター数

| サービスタイプ | 最小モニター数 | 対応ゴールデンシグナル |
|-------------|-------------|-------------------|
| Web API | 8〜12 | L+T+E+S 全カバー |
| バックグラウンドワーカー | 6〜8 | L+T+E+S 全カバー |
| データベース | 6〜8 | L+T+E+S 全カバー |
| キャッシュ | 4〜5 | E+S 重点 |
| CDN / 静的配信 | 3〜4 | T+E 重点 |
| バッチジョブ | 3〜4 | E+T (完了確認) |

---

## カバレッジスコアの計算方法

```
カバレッジスコア = (設定済みシグナル数 / 推奨シグナル数) × 100

例:
Web API で推奨8個中5個設定済み → 62.5%

評価基準:
- 100%: 完全カバー
- 80%〜99%: 良好 (Minor ギャップのみ)
- 60%〜79%: 要改善
- 60% 未満: 危険 (主要シグナルが欠落)
```
