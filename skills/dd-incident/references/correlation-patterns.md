# Correlation Patterns

インシデント調査で頻出する障害パターンと相関シグナルのリファレンス。

## パターン一覧

| パターン | トリガー | 相関シグナル | 最有力原因 |
|---------|---------|------------|-----------|
| デプロイ後エラー急増 | エラーレート上昇 + 直前デプロイ | APM エラー + デプロイイベント | 新コードのバグ |
| N+1 クエリ | エラーレート上昇 + DB 接続数急増 | APM slow spans + DB 接続数 | ORM の eager loading 漏れ |
| メモリリーク | レイテンシ徐々に増加 + 定期再起動 | ヒープサイズ増加トレンド | オブジェクトの参照残留 |
| 依存サービス障害 | 特定エンドポイントのみエラー | 外部 HTTP タイムアウトログ | 外部 API/マイクロサービス障害 |
| DB 接続プール枯渇 | API 全体が遅い/エラー | DB 接続数上限到達 | N+1/遅いクエリ/接続リーク |
| キャッシュ無効化 | レイテンシスパイク + DB 負荷上昇 | キャッシュヒット率低下 | Redis 再起動/TTL 設定ミス |
| 設定変更による障害 | デプロイなしで突然障害 | 環境変数変更 + エラーログ | 設定値の誤り/欠損 |
| 証明書期限切れ | 特定クライアントのみエラー | TLS ハンドシェイクエラーログ | SSL 証明書の期限切れ |
| ディスク枯渇 | ログ書き込みエラー + DB 障害 | ディスク使用率 100% | ログローテーション漏れ |
| DDoS/トラフィックスパイク | 全体的なレイテンシ上昇 | リクエスト数の異常増加 | 外部攻撃/イベント集中 |

---

## 詳細パターン解説

### Pattern 1: デプロイ後エラー急増

**シグネチャ**:
- エラーレートがデプロイから 2〜5 分後に上昇
- 特定のサービス/エンドポイントに集中
- APM トレースで同一エラーが繰り返される

**調査手順**:
```
1. デプロイタイムラインを確認
   datadog_mcp.list_events(tags="deployment", from="-2h")

2. エラーレートとデプロイの時刻を突き合わせ
   デプロイ + X分後にエラーレート上昇 → デプロイが原因

3. 影響エンドポイントの特定
   datadog_mcp.query_traces(query="status:error env:production")
   → 最多エラーのエンドポイントを特定

4. エラーの種類確認
   datadog_mcp.list_logs(query="status:error @error.kind:*")
   → NullPointerException / TypeError → 新コードのバグ
   → ConnectionError / TimeoutError → 依存サービス問題

5. 対処
   → 即ロールバック (リスク最小)
   → または hotfix デプロイ (修正が単純な場合)
```

---

### Pattern 2: N+1 クエリ

**シグネチャ**:
- エラーレート上昇 + DB 接続数の急増が同時発生
- レイテンシが徐々に悪化 (突然ではなくトラフィック増と比例)
- APM で DB スパン数が異常に多い

**調査手順**:
```
1. APM でスロートレースを確認
   datadog_mcp.query_traces(
     query="env:production @duration:>500000000 service:api"
   )
   → トレース詳細で DB スパン数を確認 (10件以上 → N+1 疑い)

2. DB 接続数とリクエスト数の相関確認
   query_metrics: postgresql.connections vs trace.http.request.hits
   → 比例して増加している → N+1

3. 問題クエリの特定
   datadog_mcp.list_logs(
     query="source:postgresql @duration_ms:>100"
   )
   → 繰り返し実行されている同一クエリを特定

4. 対処
   → ロールバック (即時)
   → または: ORM の N+1 を修正 (include/preload/eager_load)
```

**よくある原因コード (Node.js/Prisma)**:
```javascript
// ❌ N+1 クエリ
const posts = await prisma.post.findMany();
for (const post of posts) {
  const comments = await prisma.comment.findMany({ where: { postId: post.id } });
}

// ✅ 修正版
const posts = await prisma.post.findMany({
  include: { comments: true }
});
```

---

### Pattern 3: メモリリーク

**シグネチャ**:
- レイテンシが数時間〜数日かけて徐々に増加
- 定期的なプロセス再起動 (OOM Kill) で一時回復
- ヒープサイズが増加し続けるトレンド

**調査手順**:
```
1. メモリ使用量のトレンド確認
   datadog_mcp.query_metrics(
     query="avg:nodejs.heap_size.used{env:production} by {host}",
     from="-24h"
   )
   → 右肩上がりのグラフ → メモリリーク

2. GC 動作の確認
   query_metrics: nodejs.gc.pause_time.avg
   → GC が頻繁に動いているが回収できていない → リーク

3. OOM Kill 履歴
   datadog_mcp.list_events(
     query="OOMKilled OR out_of_memory",
     from="-7d"
   )

4. 対処 (即時)
   → ヒープダンプを取得して分析
   → 一時的にインスタンス数を増やして負荷分散
   → 定期再起動のスケジュールを組む (根本対処ではないが応急処置)

5. 根本対処
   → Node.js: EventEmitter のリスナー解除漏れ、クロージャのキャプチャ確認
   → Python: gc.garbage の確認、循環参照の特定
```

---

### Pattern 4: 依存サービス障害

**シグネチャ**:
- 特定のエンドポイント/機能のみエラー
- ログに `ETIMEDOUT`, `ECONNREFUSED`, `502 Bad Gateway` が多数
- 問題エンドポイントのスパンに外部 HTTP 呼び出しあり

**調査手順**:
```
1. エラーの局所性を確認
   → 全エンドポイントがエラー → インフラ/DB 問題
   → 特定エンドポイントのみ → 依存サービス疑い

2. 外部 API のエラーログ確認
   datadog_mcp.list_logs(
     query="status:error @http.url:api.external.com",
     from="-30m"
   )

3. 依存サービスのステータス確認
   → ステータスページを確認 (Statuspage.io 等)
   → 公式 Twitter/アナウンスを確認

4. 対処
   → Circuit Breaker をトリップ (依存サービスを一時切り離し)
   → 依存機能を Graceful Degradation (機能を無効化、エラーをキャッシュ値で代替)
   → タイムアウト/リトライ設定を見直し
```

---

### Pattern 5: DB 接続プール枯渇

**シグネチャ**:
- `too many connections` または `connection pool exhausted` エラー
- DB 接続数が max_connections に近い値で張り付く
- 全 API エンドポイントが遅い (特定エンドポイントではない)

**調査手順**:
```
1. DB 接続数の確認
   datadog_mcp.query_metrics(
     query="avg:postgresql.connections{env:production}",
     from="-1h"
   )

2. max_connections と比較
   → 80% 以上 → 枯渇リスク、90% 以上 → 枯渇中

3. 長時間接続の特定
   datadog_mcp.list_logs(
     query="source:postgresql @duration_ms:>5000",
     from="-30m"
   )

4. 原因の絞り込み
   a) N+1 クエリによる接続急増 (→ Pattern 2 参照)
   b) 遅いクエリによる接続占有 (→ スロークエリログ確認)
   c) トランザクション開きっぱなし (→ アクティブトランザクション数を確認)
   d) 接続リーク (→ デプロイ後から増加し始めた場合)

5. 対処 (即時)
   → pg_terminate_backend で長時間クエリを終了
   → コネクションプールサイズを一時的に増加
   → スケールアウトでアプリインスタンスを増加
   → 根本原因に応じてコード修正
```

---

### Pattern 6: キャッシュ無効化

**シグネチャ**:
- レイテンシが突然上昇 (徐々にではなく急に)
- DB 負荷が急増 (キャッシュをバイパスして DB に直接クエリ)
- Redis の keyspace_hits が急低下 / keyspace_misses が急増

**調査手順**:
```
1. Redis ヒット率の確認
   datadog_mcp.query_metrics(
     query="avg:redis.stats.keyspace_hits{env:production} / (avg:redis.stats.keyspace_hits{env:production} + avg:redis.stats.keyspace_misses{env:production})",
     from="-2h"
   )
   → 95%以上が正常。急低下 → キャッシュ無効化

2. Redis の再起動/フラッシュ履歴
   datadog_mcp.list_events(
     query="source:redis flushall OR restart",
     from="-2h"
   )

3. 対処
   → キャッシュのウォームアップ (重要クエリを事前実行)
   → Redis の MAXMEMORY/MAXMEMORY-POLICY 設定を確認
   → TTL 設定が短すぎないか確認
```

---

## 相関シグナルの組み合わせ判定チャート

```
エラーレート急増？
    ├─ YES + 直前デプロイあり → Pattern 1 (デプロイ後バグ)
    ├─ YES + DB 接続数急増 → Pattern 2 (N+1) or Pattern 5 (接続枯渇)
    ├─ YES + 特定エンドポイントのみ → Pattern 4 (依存サービス)
    └─ NO
        └─ レイテンシ上昇？
            ├─ YES + メモリ増加トレンド → Pattern 3 (メモリリーク)
            ├─ YES + Redis ヒット率低下 → Pattern 6 (キャッシュ無効化)
            ├─ YES + トラフィック急増 → DDoS / イベント集中
            └─ YES + ディスク 100% → ディスク枯渇
```
