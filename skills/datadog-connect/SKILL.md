---
name: datadog-connect
description: "Datadog MCP と連携して監視環境のセットアップ・運用・最適化を支援するハーネス。Use when user mentions Datadog setup, Datadog monitoring, Datadog configure, Datadog integration, monitoring setup, observability setup, harness, MCP setup, AWS/GCP/Azure monitoring, Xserver monitoring, CSPM, WAF, SIEM setup, incident investigation, monitoring best practices, audit monitoring. Trigger: 'Datadogをセットアップ', 'Datadog設定して', 'monitoring設定', 'Datadog connect', 'Datadog harness', 'MCP連携', '監視のベストプラクティス', '障害調査', 'Datadog監査'. Do NOT load for: checking alerts, viewing dashboards (use Datadog MCP directly), existing monitoring data queries."
description-ja: "Datadog MCP と連携した監視環境のセットアップ・運用・最適化ハーネス。16モジュール対応（Cloud 6/Feature 5/Security 5）、ガイド付きセットアップ、ベストプラクティス適用、インシデント対応、監査・最適化を統合提供。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[setup|plan|bestpractice|incident|audit]"
---

# Datadog MCP Harness

公式 Datadog MCP と連携して監視環境のセットアップ・運用・最適化を行うハーネススキル。

## Quick Reference

| サブスキル | トリガー | 説明 |
|-----------|---------|------|
| `dd-setup` | セットアップ / configure / 初期設定 | 環境検出 → プリセット推奨 → MCP コール計画生成 |
| `dd-bestpractice` | ベストプラクティス / 何を監視 / recommended monitors | スタック別監視推奨 → ギャップ分析 → 実装計画 |
| `dd-incident` | 障害調査 / investigate alert / インシデント対応 | トリアージ → タイムライン → 相関分析 → レポート |
| `dd-audit` | 監査 / optimize monitoring / コスト削減 | インベントリ → カバレッジ分析 → ノイズ分析 → レポート |

## サブスキルの呼び出し

### ユーザー意図の判定

```
ユーザーの入力を受信
    ↓
├── "セットアップ" / "configure" / "初期設定" / "設定して"
│       → dd-setup スキルを読み込む
├── "ベストプラクティス" / "何を監視" / "推奨モニター"
│       → dd-bestpractice スキルを読み込む
├── "障害" / "アラート調査" / "インシデント" / "本番問題"
│       → dd-incident スキルを読み込む
├── "監査" / "最適化" / "ノイズ削減" / "コスト削減"
│       → dd-audit スキルを読み込む
└── 意図が不明
        → 以下のメニューを表示
```

### 意図不明時のメニュー

```markdown
Datadog MCP Harness へようこそ。

何をしますか？

1. **セットアップ** — Datadog の初期設定・インテグレーション追加
2. **ベストプラクティス** — スタックに合った監視の推奨事項を確認
3. **インシデント対応** — 障害調査・アラートのトリアージ
4. **監査・最適化** — 監視のカバレッジ確認・コスト削減

番号または内容を教えてください。
```

## 公式 Datadog MCP との連携

本ハーネスは直接 API を呼ばず、公式 Datadog MCP ツール経由で操作します。

| Datadog MCP ツール | 用途 |
|-------------------|------|
| `create_monitor` | モニター作成 |
| `list_monitors` | モニター一覧取得 |
| `get_dashboard` | ダッシュボード取得 |
| `create_dashboard` | ダッシュボード作成 |
| `query_metrics` | メトリクスクエリ |
| `list_logs` | ログ検索 |
| `get_host_and_metrics` | ホスト情報取得 |

## 対応モジュール（dd-setup）

**Cloud (6)**: AWS, GCP, Azure, On-Prem, Kubernetes, Xserver
**Feature (5)**: APM, Logs, Dashboards, Monitors, Synthetics
**Security (5)**: CSPM, CWS, ASM, SIEM, Sensitive Data Scanner
