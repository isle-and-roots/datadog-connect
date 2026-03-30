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

## 使い方（はじめての方向け）

### 事前に必要なもの

1. **Node.js** (v20以上) — [ダウンロードはこちら](https://nodejs.org/)
   - インストール後、ターミナルで `node -v` と入力して `v20.x.x` 以上が表示されればOK
2. **Datadog アカウント** — [Datadog](https://www.datadoghq.com/) でアカウントを作成
3. **Datadog API Key と Application Key** — 以下の手順で取得:
   - Datadog にログイン
   - 左メニュー下の **Organization Settings** > **API Keys** で API Key をコピー
   - 同じ画面の **Application Keys** で Application Key を作成してコピー

### Step 1: ツールをダウンロード

ターミナル（Mac: ターミナル.app / Windows: PowerShell）を開いて、以下を実行:

```bash
git clone https://github.com/isle-and-roots/datadog-connect.git
cd datadog-connect
npm install
```

### Step 2: セットアップウィザードを起動

```bash
npx tsx src/index.ts setup
```

すると、対話形式のウィザードが始まります:

```
🐕 Datadog Connect — かんたんセットアップ

  Step 1: 認証
  ? Datadogサイト: US1 (datadoghq.com)
  ? API Key: ********
  ? Application Key: ********
  ✅ 認証OK

  Step 2: 機能選択
  ? どの機能を有効にしますか？ (スペースで選択)
    ✅ AWS統合
    ✅ モニター/アラート
    ✅ ダッシュボード
    ...
```

画面の指示に従って選択するだけで、Datadog の設定が自動で完了します。

### Step 3: 結果を確認

セットアップが完了すると:
- **自動設定されたもの**: Datadog の管理画面にダッシュボードやモニターが作成されます
- **手動手順書**: `~/.datadog-connect/output/` フォルダに、手動で行う手順（IAMロール作成など）が出力されます

### 環境変数で認証をスキップ（オプション）

毎回キーを入力するのが面倒な場合、環境変数を設定すると自動で認証されます:

```bash
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"
npx tsx src/index.ts setup
```

### その他のコマンド

| コマンド | 説明 |
|---------|------|
| `npx tsx src/index.ts setup` | セットアップウィザードを開始 |
| `npx tsx src/index.ts setup --profile customer-a` | 顧客別にプロファイルを分けて実行 |
| `npx tsx src/index.ts rollback` | 作成したリソースを削除（やり直したい場合） |
| `npx tsx src/index.ts rollback --session セッションID` | 特定のセッションのリソースを削除 |
| `npx tsx src/index.ts mcp` | **Datadog MCP サーバーを Claude Code に接続** |

### Claude Code から Datadog を使う（MCP接続）

1コマンドで Datadog MCP サーバーを Claude Code に接続できます:

```bash
# 環境変数を設定
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"

# MCP サーバーを接続
npx tsx src/index.ts mcp
```

接続後、Claude Code で以下のように Datadog を操作できます:

```
「Datadogの直近のアラートを確認して」
「CPU使用率が高いホストを調べて」
「本番環境のエラーログを検索して」
「新しいモニターを作成して」
```

### 困ったときは

- **認証エラー**: API Key と Application Key が正しいか確認してください
- **機能がスキップされた**: お使いの Datadog プランで利用できない機能は自動でスキップされます
- **途中で止まった**: 同じコマンドで再度実行すれば、途中から再開できます

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
