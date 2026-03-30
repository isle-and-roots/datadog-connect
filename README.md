# Datadog Connect

Datadog の全機能セットアップを1コマンドで完結させる CLI ウィザード。
顧客向け提案パッケージとして、対話形式でヒアリング → 自動設定 → 手順書出力を行います。

```bash
npx datadog-connect setup
```

Node.js (v20以上) があれば、これだけで使えます。インストール不要。

> 📖 **操作ガイド（HTML版）**: `docs/guide.html` をブラウザで開くと、画像付きの詳しいガイドが見られます。

## Features

### 16 モジュール

**Cloud (6)**
| モジュール | 機能 |
|-----------|------|
| AWS | 統合API + IAMロール CloudFormation テンプレート |
| GCP | STS統合 (Workload Identity Federation) + gcloud セットアップスクリプト |
| Azure | 統合API + az CLI スクリプト |
| On-Prem | OS別 Agent インストールコマンド + Ansible |
| Kubernetes | Helm values / Operator CR 生成 |
| Xserver | VPS/専用サーバー + Nginx/MySQL 監視設定 + ブラウザ自動設定 |

**Feature (5)**
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

### ブラウザ自動取得

Playwright を使って、ログインするだけで各サービスの情報を自動取得:
- **Datadog**: API Key / Application Key
- **AWS**: Account ID
- **GCP**: Project ID
- **Azure**: Subscription ID
- **Xserver**: VPS情報 + ファイアウォール自動設定

## 使い方（はじめての方向け）

### 事前に必要なもの

1. **Node.js** (v20以上) — [ダウンロードはこちら](https://nodejs.org/)
   - インストール後、ターミナルで `node -v` と入力して `v20.x.x` 以上が表示されればOK
2. **Datadog アカウント** — [Datadog](https://www.datadoghq.com/) でアカウントを作成
3. **Datadog API Key と Application Key** — 以下の手順で取得:
   - Datadog にログイン
   - 左メニュー下の **Organization Settings** > **API Keys** で API Key をコピー
   - 同じ画面の **Application Keys** で Application Key を作成してコピー
   - **または**: ブラウザ自動取得を使えば、ログインするだけでOK

### Step 1: ツールをダウンロード

ターミナル（Mac: ターミナル.app / Windows: PowerShell）を開いて、以下を実行:

```bash
git clone https://github.com/isle-and-roots/datadog-connect.git
cd datadog-connect
npm install
```

### Step 2: セットアップウィザードを起動

```bash
npm run setup
```

すると、対話形式のウィザードが始まります:

```
🐕 Datadog Connect — かんたんセットアップ

  Step 1: 認証
  ? 認証情報の取得方法:
    ❯ 🌐 ブラウザで自動取得（おすすめ）— ログインするだけでOK
      ⌨️  手動入力 — キーを自分でコピペする

  Step 2: セットアップタイプ
  ? セットアップタイプを選んでください:
    ⭐ おすすめセット — ダッシュボード + モニター + ログ
    ☁️  AWS環境向け
    ☁️  GCP環境向け
    🔒 セキュリティ重視
    🖥️  Xserver向け
    🚀 フル — 全16モジュール
    ⚙️  カスタム — 個別に選択

  Step 3: ダッシュボード [1/3]
  ✅ ダッシュボード 完了 (作成: 5件)

  Step 4: モニター/アラート [2/3]
  ✅ モニター/アラート 完了 (作成: 25件)

  📊 作成: 30件 | 手動手順: 0件 | エラー: 0件

  📋 次のステップ
  ℹ️  モニターは約10分後に初回チェックを実行します。
```

### Step 3: 結果を確認

セットアップが完了すると:
- **自動設定されたもの**: Datadog の管理画面にダッシュボードやモニターが作成されます
- **手動手順書**: `~/.datadog-connect/output/` フォルダに、手動で行う手順（IAMロール作成など）が出力されます

### 環境変数で認証をスキップ（オプション）

毎回キーを入力するのが面倒な場合、環境変数を設定すると自動で認証されます:

```bash
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"
npm run setup
```

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm run setup` | セットアップウィザードを開始 |
| `npm run resume` | 前回の失敗モジュールだけ再実行 |
| `npm run rollback` | 作成したリソースを削除（やり直したい場合） |
| `npm run mcp` | Datadog MCP サーバーを Claude Code に接続 |

### Claude Code から Datadog を使う（MCP接続）

1コマンドで Datadog MCP サーバーを Claude Code に接続できます:

```bash
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"
npm run mcp
```

接続後、Claude Code で以下のように Datadog を操作できます:

```
「Datadogの直近のアラートを確認して」
「CPU使用率が高いホストを調べて」
「本番環境のエラーログを検索して」
「新しいモニターを作成して」
```

### 困ったときは

- **認証エラー**: API Key と Application Key が正しいか確認してください。3回まで再入力できます
- **Datadogサイトの選び方**: ログインURL が `app.datadoghq.com` なら US1、`ap1.datadoghq.com` なら AP1 です
- **機能がスキップされた**: お使いの Datadog プランで利用できない機能は自動でスキップされます
- **途中で止まった**: `npm run resume` で前回の失敗モジュールだけ再実行できます
- **設定を元に戻したい**: `npm run rollback` で作成リソースを削除できます
- **ブラウザ自動取得がうまくいかない**: 手動入力に自動で切り替わります

## Claude Code プラグインとして使う

Datadog Connect は Claude Code のネイティブプラグインとしても動作します。

### セットアップ

```bash
# プラグインとして登録
claude plugins add /path/to/datadog-connect
```

### 使い方

Claude Code で以下のように話しかけるだけ:

```
「Datadogをセットアップして」
「GCP環境にDatadog監視を設定して」
「Datadogのセキュリティ機能を有効にして」
```

または直接コマンド:

```
/datadog-connect setup
/datadog-connect resume
/datadog-connect rollback
/datadog-connect mcp
```

## Security Design

- **Preflight**: セキュリティモジュールは実行前にAPIプローブでプラン確認。非対応なら自動スキップ
- **Monitor Mode**: ASM/WAF ルールは monitor モード（検出のみ、ブロックしない）で作成
- **Shell Escape**: 全スクリプト生成でユーザー入力をシェルエスケープ (`escapeShellArg`)
- **Secure Output**: ファイル出力は `~/.datadog-connect/output/` に `0o600`/`0o700` で保存
- **Credential Safety**: 認証情報はセッションファイルから除去 (`sanitizeConfig`)
- **Browser Safety**: ブラウザ操作は常に画面表示（ヘッドレスにしない）、取得値はバリデーション後に使用
- **Rollback**: 作成リソースをジャーナルに記録、`rollback` コマンドで削除可能

## Tech Stack

- TypeScript + tsx
- Commander (CLI)
- @inquirer/prompts (対話)
- @datadog/datadog-api-client (API)
- Playwright (ブラウザ自動化、optional)
- Zod (バリデーション)
- tsup (ビルド)
