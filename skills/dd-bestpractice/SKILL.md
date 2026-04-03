---
name: dd-bestpractice
description: "Monitoring best practices skill for Datadog. Use when user asks what to monitor, wants recommended monitors, best practices for observability. Triggers: '監視のベストプラクティス', 'recommended monitors', '何を監視すべき', 'monitoring recommendations', 'モニター設定', 'SLO設定', 'what should I monitor', 'アラート多すぎ', 'alert fatigue', 'what monitors do I need', 'monitor recommendations', 'too many notifications'. Do NOT load for: initial setup tasks, incident investigation, audit tasks, alert noise analysis (use dd-audit), cost optimization (use dd-audit)."
description-ja: "スタック別監視ベストプラクティス。スタック特定 → 推奨モニター照合 → ギャップ分析 → 実装計画を提供。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[stack-type]"
---

# dd-bestpractice: 監視ベストプラクティス

スタックに最適な監視構成を推奨し、現在のギャップを分析して実装計画を提示します。

## Workflow

```
Step 1: スタック特定
    ↓ 現在の環境 or ユーザー入力から判定
Step 2: ベストプラクティス照合
    ↓ stack-monitors.md から推奨モニター一覧を取得
Step 3: 現状確認 (Datadog MCP)
    ↓ list_monitors で既存モニターを取得
Step 4: ギャップ分析
    ↓ 推奨 vs 現状を比較
Step 5: 実装計画の提示
    ↓ 不足モニター/ダッシュボードの作成計画を出力
```

## Step 2: ベストプラクティス照合

スタック別推奨モニター: [references/stack-monitors.md](references/stack-monitors.md)
ダッシュボードテンプレート: [references/dashboard-templates.md](references/dashboard-templates.md)

## Step 3: 現状確認

```
# 公式 Datadog MCP で既存モニターを取得
datadog_mcp.list_monitors()
datadog_mcp.get_dashboard(dashboard_id="*")
```

## Step 4: ギャップ分析の出力例

```markdown
## 監視ギャップ分析

### スタック: Node.js + PostgreSQL + AWS ECS

#### 推奨モニター (18個) vs 現状 (7個)

| カテゴリ | 推奨 | 設定済み | 不足 |
|---------|------|---------|------|
| アプリケーション | 6個 | 3個 | 3個 |
| インフラ | 5個 | 2個 | 3個 |
| データベース | 4個 | 1個 | 3個 |
| ビジネス | 3個 | 1個 | 2個 |

#### 優先度別の不足モニター

🔴 Critical (即時対応推奨):
- [ ] HTTP 5xx エラーレート > 1%
- [ ] サービス停止検出
- [ ] PostgreSQL デッドロック検出

🟠 High (今週中):
- [ ] P99 レイテンシ > 2000ms
- [ ] DB 接続プール枯渇
- [ ] メモリリーク検出 (ヒープ増加トレンド)

🟡 Medium (今月中):
- [ ] ビジネスメトリクス (新規登録数、決済失敗率)
- [ ] SLO ダッシュボード
```

## Step 5: 実装計画

```markdown
## 実装計画

Critical モニター (3個) を今すぐ作成しますか？

実行される Datadog MCP 呼び出し:
1. `create_monitor` — HTTP 5xx エラーレート
2. `create_monitor` — サービス停止 (Synthetic)
3. `create_monitor` — PostgreSQL デッドロック

実行: y / スキップ: n / 個別選択: s
```
