---
name: dd-setup
description: "Guided Datadog setup skill. Use when user wants to set up Datadog, add integrations, configure monitoring for a new environment. Triggers: 'Datadogをセットアップ', 'monitoring setup', 'Datadog configure', 'Datadog初期設定', 'インテグレーション追加', 'add AWS integration', 'already configured', '再設定', 'reconfigure', 'monitoring始めたい', 'Terraform monitoring', '既に設定済み', 'extend monitoring'. Do NOT load for: querying existing monitors, incident investigation, audit tasks."
description-ja: "ガイド付き Datadog セットアップ。環境検出 → プリセット推奨 → 公式 Datadog MCP コール計画を自動生成。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[stack-profile]"
---

# dd-setup: ガイド付きセットアップ

環境を自動検出し、スタックに最適なプリセットを推奨して、公式 Datadog MCP の実行計画を生成します。

## Workflow

```
Step 1: 環境検出
    ↓ ファイルパターンからインフラを推定
Step 2: プリセット推奨
    ↓ スタックプロファイル → preset + module_configs を提示
Step 3: ユーザー確認
    ↓ 追加/除外モジュールを対話で調整
Step 4: MCP コール計画生成
    ↓ 実行する Datadog MCP ツール呼び出し順序をリスト化
Step 5: 実行 or プラン保存
```

## Step 1: 環境検出

プロジェクトルートの以下のファイルパターンを確認してスタックを推定する。
詳細ルール: [references/stack-detection-rules.md](references/stack-detection-rules.md)

```bash
# 検出コマンド例
ls -la && cat package.json 2>/dev/null | head -30
ls Dockerfile docker-compose.yml terraform/ kubernetes/ 2>/dev/null
```

| 検出シグナル | 推定スタック |
|-------------|-------------|
| `package.json` あり | Node.js/Web アプリ |
| `Dockerfile` あり | コンテナ環境 |
| `terraform/` あり | IaC (AWS/GCP/Azure) |
| `kubernetes/` or `k8s/` あり | Kubernetes |
| `requirements.txt` or `pyproject.toml` | Python アプリ |
| `pom.xml` or `build.gradle` | Java/JVM アプリ |
| `go.mod` あり | Go アプリ |

## Step 2: プリセット推奨

検出結果からスタックプロファイルを判定し、プリセットを推奨する。
詳細マッピング: [references/preset-mapping.md](references/preset-mapping.md)

```markdown
## 推奨セットアップ

検出されたスタック: **Node.js + Docker + AWS**

推奨プリセット: **AWS Web App**

含まれるモジュール:
- ✅ AWS Integration (CloudWatch, EC2, RDS, ALB)
- ✅ APM (Node.js tracer)
- ✅ Logs (Docker log collection)
- ✅ Monitors (基本アラート 12個)
- ✅ Dashboards (サービス概要 + インフラ)

オプション:
- [ ] Synthetics (外形監視) — 追加しますか？
- [ ] CSPM (クラウドセキュリティ) — 追加しますか？

このプリセットで進めますか？ (y/n/カスタム)
```

## Step 3: MCP コール計画生成

確認後、実行する Datadog MCP ツールの呼び出し計画を出力する。

```markdown
## 実行計画 (Datadog MCP)

### Phase 1: インテグレーション設定
1. `configure_aws_integration` — AWS Account ID, IAM Role ARN を設定
2. `enable_log_collection` — Docker コンテナログ収集を有効化

### Phase 2: モニター作成
3. `create_monitor` — CPU 使用率 > 85% アラート
4. `create_monitor` — メモリ使用率 > 90% アラート
5. `create_monitor` — エラーレート > 1% アラート
6. `create_monitor` — P99 レイテンシ > 2s アラート

### Phase 3: ダッシュボード作成
7. `create_dashboard` — サービス概要ダッシュボード
8. `create_dashboard` — インフラ監視ダッシュボード

実行しますか？ (y = 全実行 / n = プラン保存のみ)
```
