# Datadog Connect

Datadog の全機能セットアップを1コマンドで完結させる CLI ウィザード。
顧客向け提案パッケージとして、対話形式でヒアリング → 自動設定 → 手順書出力を行います。

## Features

### 17 モジュール

**Cloud (6)**
| モジュール | 機能 |
|-----------|------|
| AWS | 統合API + IAMロール CloudFormation テンプレート |
| GCP | STS統合 + gcloud セットアップスクリプト |
| Azure | 統合API + az CLI スクリプト |
| On-Prem | OS別 Agent インストールコマンド + Ansible |
| Kubernetes | Helm values / Operator CR 生成 |
| Xserver | VPS/専用サーバー + Nginx/MySQL 監視設定 |

**Feature (6)**
| モジュール | 機能 |
|-----------|------|
| APM | サービスカタログ + 7言語計装ガイド |
| Logs | パイプライン自動作成 (Nginx/Apache/JSON/Syslog) |
| Dashboards | 5プリセット自動作成 |
| Monitors | 6パック 25+定義 (Infra/AWS/K8s/APM/Logs/Cost) |
| Synthetics | APIテスト自動作成 |

**Security (5)**
| モジュール | 機能 |
|-----------|------|
| CSPM | Agentless スキャン (AWS/GCP/Azure) |
| CWS | ワークロード保護ポリシー・ルール |
| ASM | WAFルール (monitor モード) + 除外フィルター |
| SIEM | 検出ルール 4パック + シグナル通知 |
| Sensitive Data Scanner | 機密データスキャン (PII/CC/APIキー) |

## Setup

```bash
# 依存インストール
npm install

# 開発実行
npx tsx src/index.ts setup

# ビルド
npm run build
```

## Environment Variables

| 変数 | 説明 | 必須 |
|------|------|------|
| `DD_API_KEY` | Datadog API Key | 設定時はインタラクティブ入力をスキップ |
| `DD_APP_KEY` | Datadog Application Key | 同上 |
| `DD_SITE` | Datadog サイト (例: datadoghq.com) | デフォルト: datadoghq.com |

## CLI Commands

```bash
# セットアップウィザード
datadog-connect setup [--profile <name>]

# 中断セッション再開
datadog-connect resume [--session <id>]

# リソースロールバック
datadog-connect rollback [--session <id>]
```

## Security Design

- **Preflight**: セキュリティモジュールは実行前にAPIプローブでプラン確認。非対応なら自動スキップ
- **Monitor Mode**: ASM/WAF ルールは monitor モード（検出のみ、ブロックしない）で作成
- **Shell Escape**: 全スクリプト生成でユーザー入力をシェルエスケープ (`escapeShellArg`)
- **Secure Output**: ファイル出力は `~/.datadog-connect/output/` に `0o600`/`0o700` で保存
- **Credential Safety**: 認証情報はセッションファイルから除去 (`sanitizeConfig`)、OS キーチェーン対応準備済み
- **Rollback**: 作成リソースをジャーナルに記録、`rollback` コマンドで削除可能

## Tech Stack

- TypeScript + tsx
- Commander (CLI)
- @inquirer/prompts (対話)
- @datadog/datadog-api-client (API)
- Zod (バリデーション)
- tsup (ビルド)
