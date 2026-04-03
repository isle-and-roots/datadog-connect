---
name: dd-incident
description: "Incident response and investigation skill for Datadog. Use when user needs to investigate alerts, debug production issues, respond to incidents. Triggers: '障害調査', 'investigate alert', 'production issue', 'インシデント対応', 'アラートが鳴っている', 'サービスが落ちた', 'エラーが増えた', 'latency spike', '本番問題', 'error rate increasing', '高負荷', 'timeout増加', 'service down', 'レスポンス遅い', 'performance degradation'. Do NOT load for: setup tasks, best practices consultation, audit/optimization tasks."
description-ja: "インシデント対応・障害調査スキル。トリアージ → タイムライン構築 → 相関分析 → レポートと再発防止策を提供。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[alert-id|service-name]"
---

# dd-incident: インシデント対応

アラート受信からトリアージ、根本原因分析、再発防止策まで一貫してサポートします。

## Workflow

```
Step 1: トリアージ → 重大度 P1〜P4 を判定
Step 2: タイムライン構築 (Datadog MCP)
Step 3: 相関分析 → 既知パターンと照合
Step 4: 根本原因の特定 (仮説 → 検証)
Step 5: レポート生成 + 再発防止策
```

## Step 1: トリアージ

詳細手順: [references/incident-playbook.md](references/incident-playbook.md)

| 重大度 | 条件 | 応答時間 |
|--------|------|---------|
| P1 Critical | サービス全停止 / 決済不可 | 5分以内 |
| P2 High | 主要機能停止 / エラーレート > 5% | 15分以内 |
| P3 Medium | 一部機能劣化 / エラーレート 1-5% | 1時間以内 |
| P4 Low | パフォーマンス低下のみ | 翌営業日 |

## Step 2: タイムライン構築 (Datadog MCP)

```
datadog_mcp.query_metrics(
  query="sum:trace.http.request.errors{env:production}.as_rate()",
  from=incident_start - 30min
)
datadog_mcp.list_logs(query="status:error env:production", from=incident_start - 30min)
datadog_mcp.list_events(tags="env:production", from=incident_start - 60min)
```

メトリクス・ログ・イベントから時系列を構築し、「問題が始まった時刻」と「直前のイベント」を特定する。

## Step 3: 相関分析

既知の障害パターンと照合する。
詳細: [references/correlation-patterns.md](references/correlation-patterns.md)

主要パターン:
- デプロイ後エラー急増 → コードバグ / ロールバック
- エラー + DB 接続数急増 → N+1 クエリ or 接続プール枯渇
- 特定エンドポイントのみエラー → 依存サービス障害
- レイテンシ徐々に増加 → メモリリーク
- 突然レイテンシ上昇 + DB 負荷増 → キャッシュ無効化

## Step 4: 根本原因の特定

```
最有力仮説を1つ選ぶ (タイムラインと最も相関が高いもの)
    ↓
5分以内で検証 (ログ/APM トレース/メトリクスで確認)
    ↓
確定 → 対処へ / 否定 → 次の仮説へ
```

対処オプション (優先度順):
1. ロールバック (デプロイが原因の場合)
2. フィーチャーフラグ無効化
3. スケールアウト (負荷増大の応急処置)
4. 設定修正 + デプロイ
5. 依存サービスの切り離し (circuit breaker)

## Step 5: レポート生成

詳細テンプレート: [references/incident-playbook.md](references/incident-playbook.md)

Post-Mortem 必須項目: タイムライン / 根本原因 / 対処内容 / 再発防止策 (担当+期限付き)
