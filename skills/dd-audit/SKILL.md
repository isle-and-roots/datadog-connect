---
name: dd-audit
description: "Audit and optimization skill for Datadog monitoring. Use when user wants to review monitoring coverage, reduce alert noise, optimize costs, or audit their Datadog setup. Triggers: 'Datadog監査', 'optimize monitoring', 'reduce noise', 'コスト削減', 'アラートが多すぎる', 'monitoring coverage', '監視の見直し', 'Datadog費用'. Do NOT load for: initial setup tasks, incident investigation, best practices consultation."
description-ja: "Datadog 監視の監査・最適化スキル。インベントリ → カバレッジ分析 → ノイズ分析 → コスト分析 → 最適化レポートを提供。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[focus: coverage|noise|cost|all]"
---

# dd-audit: 監視監査・最適化

現在の Datadog 設定を総合的に監査し、カバレッジの穴・アラートノイズ・コスト改善を提案します。

## Workflow

```
Step 1: インベントリ収集 (Datadog MCP)
    ↓ 全モニター・ダッシュボード・ログパイプラインを取得
Step 2: カバレッジ分析
    ↓ golden-signals.md のゴールデンシグナルと照合
Step 3: ノイズ分析
    ↓ フラッピング・低品質モニターを特定
Step 4: コスト分析
    ↓ cost-optimization.md のストラテジーと照合
Step 5: 最適化レポート生成 → 実装
```

## Step 1: インベントリ収集 (Datadog MCP)

```
datadog_mcp.list_monitors()          # 全モニター一覧
datadog_mcp.list_dashboards()        # 全ダッシュボード一覧
datadog_mcp.get_logs_pipelines()     # ログパイプライン一覧
datadog_mcp.list_synthetics_tests()  # Synthetics テスト一覧
```

## Step 2: カバレッジ分析

ゴールデンシグナル定義: [references/golden-signals.md](references/golden-signals.md)

推奨ゴールデンシグナル (Latency / Traffic / Errors / Saturation) と現状モニターを比較し、
不足しているモニターを優先度付きでリストアップする。

## Step 3: ノイズ分析

フラッピングモニター (アラート → 解決を繰り返す) と通知先未設定モニターを特定する。

- フラッピング: `alert_count / resolve_count > 0.9` かつ `alert_count > 10 (30日間)`
- 推奨対処: 閾値引き上げ or 評価期間を延長 (5分 → 15分)
- 通知先未設定: アラートしても誰にも届かないモニターを警告

## Step 4: コスト分析

コスト最適化戦略: [references/cost-optimization.md](references/cost-optimization.md)

主なコストドライバーを分析し削減量を試算する:
- ログボリューム (サービス別 GB/日)
- 未使用カスタムメトリクス
- APM トレースサンプリング率
- Synthetics 実行頻度

## Step 5: 最適化レポート

```
## Datadog 最適化レポート

| カテゴリ | 問題件数 | 優先度 |
|---------|---------|--------|
| カバレッジ不足 | X件 | 高 |
| フラッピングモニター | X件 | 中 |
| 通知先未設定 | X件 | 高 |
| コスト最適化 | X件 | 中 |

実装しますか？ (y = 全実行 / s = 選択実行)
```
