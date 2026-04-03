# Cost Optimization

Datadog のコスト削減戦略と実装方法。

## コスト構造の理解

Datadog の主なコストドライバー:

| コスト項目 | 課金単位 | 削減難易度 |
|----------|---------|-----------|
| **Logs** | GB/月 (取り込み + 保存) | 易 |
| **Custom Metrics** | メトリクス数 (時系列) | 易〜中 |
| **APM** | スパン数 (サンプリング率で調整) | 中 |
| **Synthetics** | テスト実行回数 | 易 |
| **Infrastructure** | ホスト数 | 難 |
| **RUM** | セッション数 | 中 |

---

## ログコスト削減

### 1. ログサンプリング (最も効果的)

DEBUG/INFO レベルのログをサンプリングして取り込みを削減。

```yaml
# datadog-agent/conf.d/logs.d/app.yaml
logs:
  - type: docker
    service: api-server
    source: node
    sampling_rules:
      # DEBUG ログは 5% のみ取り込む
      - sample_rate: 0.05
        match: '@level:debug'
      # INFO ログは 20% のみ取り込む
      - sample_rate: 0.20
        match: '@level:info'
      # ERROR/WARN は 100% 取り込む
      - sample_rate: 1.0
        match: '@level:(error OR warn)'
```

**期待効果**: ログボリューム 60〜80% 削減

### 2. ログフィルタリング (不要ログの除外)

```yaml
# 特定のログを完全に除外
logs:
  - type: docker
    service: nginx
    source: nginx
    log_processing_rules:
      # ヘルスチェックのアクセスログを除外
      - type: exclude_at_match
        name: exclude_healthcheck
        pattern: '(GET|HEAD) /health'
      # 2xx/3xx の成功ログを除外 (エラーのみ保持)
      - type: exclude_at_match
        name: exclude_success
        pattern: '" (2|3)[0-9]{2} '
```

**期待効果**: Nginx ログ 70〜90% 削減

### 3. ログ保存期間の最適化

| ログ種別 | 推奨保存期間 | 理由 |
|---------|-----------|------|
| エラーログ | 30日 (Standard) | インシデント分析に必要 |
| アクセスログ | 7日 (Flex) | 通常の障害調査範囲 |
| DEBUG ログ | 3日 (Flex) | 短期デバッグのみ |
| セキュリティログ | 90日+ | コンプライアンス要件 |

```python
# Datadog MCP でログインデックスのTTLを更新
datadog_mcp.update_logs_index(
  index_name="main",
  retention_days=7,      # デフォルト 30日 → 7日
  num_retention_days=7
)
```

### 4. ログアーカイブ (長期保存)

頻繁にアクセスしないログはS3にアーカイブ:

```yaml
# ログアーカイブ設定 (Datadog UI または Terraform)
resource "datadog_logs_archive" "main" {
  name  = "s3-archive"
  query = "env:production"
  s3_archive {
    bucket     = "my-datadog-logs-archive"
    path       = "/logs"
    account_id = "123456789"
    role_name  = "DatadogArchiveRole"
  }
}
```

---

## カスタムメトリクスコスト削減

### 1. 未使用メトリクスの特定と削除

```
# Datadog MCP でメトリクス使用状況を確認
datadog_mcp.list_metrics(q="type:gauge")
datadog_mcp.get_metrics_volumes()  # 取り込みボリューム確認
```

未使用メトリクスの判断基準:
- 過去30日間にダッシュボードやモニターで参照されていない
- `tags` が過剰に多い (カーディナリティが高い)

### 2. タグのカーディナリティ削減 (最重要)

高カーディナリティタグはカスタムメトリクスを爆発的に増加させる。

```python
# ❌ 悪い例: user_id を タグに含める
statsd.increment('api.request', tags=['user_id:12345', 'endpoint:/users'])
# user_id の種類数 × endpoint 数 = 10万ユーザー × 50エンドポイント = 500万メトリクス

# ✅ 良い例: user_id を タグから除外
statsd.increment('api.request', tags=['endpoint:/users', 'method:GET'])
# 50エンドポイント × 5メソッド = 250メトリクス
```

**除外すべき高カーディナリティタグ**:
- `user_id`, `session_id`, `request_id`
- `customer_id`, `tenant_id` (大規模な場合)
- `ip_address`
- ランダムなUUID

```yaml
# datadog.yaml でタグをブロックリスト設定
exclude_tags:
  - user_id
  - session_id
  - request_id
```

### 3. メトリクス集約

```python
# ❌ 悪い例: 細かい粒度で送信
for item in cart.items:
    statsd.increment('cart.item.added', tags=['item_id:' + item.id])

# ✅ 良い例: バッチで集約
statsd.gauge('cart.items.count', len(cart.items), tags=['cart_id:' + cart.id])
```

---

## APM コスト削減

### 1. トレースサンプリング

本番環境では全トレースを取り込む必要はない。エラーと遅いトレースを優先。

```python
# Python (ddtrace) のサンプリング設定
from ddtrace import tracer, config

# グローバルサンプリングレートを設定
tracer.configure(
    settings={
        "SAMPLING_RULES": [
            # エラートレースは 100% 保持
            {"error": True, "sample_rate": 1.0},
            # P95 以上のスローリクエストは 100% 保持
            {"min_spans": 1, "sample_rate": 1.0, "resource": "slow_endpoint"},
            # その他は 10% サンプリング
            {"sample_rate": 0.1}
        ]
    }
)
```

```yaml
# datadog-agent で設定する場合
apm_config:
  analyzed_spans:
    # エラーは全て保持
    "*|error": 1.0
    # 主要エンドポイントは 100% 保持
    "web.request|/checkout": 1.0
    # その他は 20% サンプリング
    "web.request|*": 0.2
```

**期待効果**: APM コスト 50〜80% 削減 (エラー/スローは 100% 保持)

### 2. 不要なスパン除外

```python
# ヘルスチェックのトレースを除外
from ddtrace import patch_all
from ddtrace.contrib.trace_utils import set_http_meta

@tracer.ignore(resource="/health")
def health_check():
    return {"status": "ok"}
```

---

## Synthetics コスト削減

### テスト実行間隔の最適化

| テストタイプ | 本番推奨間隔 | ステージング推奨間隔 |
|------------|-----------|------------------|
| API ヘルスチェック | 5分 | 15分 |
| ブラウザテスト (クリティカルパス) | 15分 | 60分 |
| ブラウザテスト (通常) | 60分 | 無効化 |
| 証明書チェック | 1日 | 不要 |

```python
# Datadog MCP でテスト間隔を更新
datadog_mcp.update_synthetics_test(
  public_id="abc-123",
  options={
    "tick_every": 900  # 15分 (900秒)
  }
)
```

---

## コスト最適化チェックリスト

### ログ
- [ ] DEBUG/INFO ログのサンプリング設定 (10〜20%)
- [ ] ヘルスチェックアクセスログの除外
- [ ] 不要な詳細ログの除外フィルター追加
- [ ] 保存期間の見直し (7〜15日で十分なログ)
- [ ] 長期保存が必要なログのS3アーカイブ設定

### カスタムメトリクス
- [ ] 未使用メトリクスの特定と停止
- [ ] 高カーディナリティタグ (user_id, request_id等) の除外
- [ ] 同一データの重複メトリクスの統合

### APM
- [ ] エラー以外のトレースのサンプリング設定 (10〜20%)
- [ ] ヘルスチェック等の不要なトレース除外
- [ ] 本番のみサンプリング (ステージングは全収集)

### Synthetics
- [ ] 重要度低いブラウザテストの実行間隔を延長
- [ ] ステージング環境の Synthetics を間引く

---

## コスト削減の優先順位

```
コスト削減インパクト (大 → 小):

1. ログサンプリング + フィルタリング    💰💰💰 (30〜60% 削減の余地)
2. APM サンプリング                   💰💰   (20〜50% 削減の余地)
3. カスタムメトリクスのカーディナリティ  💰💰   (20〜40% 削減の余地)
4. 未使用メトリクスの削除              💰     (5〜15% 削減の余地)
5. Synthetics 間隔調整                💰     (5〜10% 削減の余地)
```
