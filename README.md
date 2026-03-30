# Datadog Connect

Datadog の全機能セットアップを1コマンドで完結させる CLI ウィザード。
対話形式でヒアリング → Datadog API で自動設定 → 手順書出力まで、ワンストップで行います。

```bash
npx datadog-connect setup
```

> **Claude Code ユーザーの方へ**: プラグインとして使うとさらに便利です → [Claude Code プラグイン](#claude-code-プラグインとして使う推奨)

## Claude Code プラグインとして使う（推奨）

Datadog Connect は Claude Code のネイティブプラグインとして動作します。
自然言語で Datadog のセットアップができます。

### インストール & 登録

```bash
npm install -g datadog-connect
claude plugins add $(npm root -g)/datadog-connect
```

### 使い方

Claude Code で話しかけるだけ:

```
「Datadogをセットアップして」
「GCP環境にDatadog監視を設定して」
「Datadogのセキュリティ機能を有効にして」
「前回の失敗を再実行して」
```

スラッシュコマンドでも:

```
/datadog-connect setup      # セットアップウィザード
/datadog-connect resume     # 前回の失敗モジュールを再実行
/datadog-connect rollback   # 作成リソースを削除
/datadog-connect mcp        # Datadog MCP サーバーを接続
```

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

## CLI として使う（Claude Code なしの場合）

### 事前に必要なもの

1. **Node.js** (v20以上) — [ダウンロードはこちら](https://nodejs.org/)
2. **Datadog アカウント** — [Datadog](https://www.datadoghq.com/) でアカウントを作成
3. **Datadog API Key と Application Key**:
   - Datadog > **Organization Settings** > **API Keys** で API Key をコピー
   - 同画面の **Application Keys** で Application Key を作成してコピー
   - **または**: ブラウザ自動取得を使えば、ログインするだけでOK

### npx で実行（インストール不要）

```bash
npx datadog-connect setup
```

### グローバルインストール

```bash
npm install -g datadog-connect
datadog-connect setup
```

### ソースから実行

```bash
git clone https://github.com/isle-and-roots/datadog-connect.git
cd datadog-connect
npm install
npm run setup
```

### ウィザードの流れ

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

  全て成功 (成功率 100%)
  作成: 30件 | 手動手順: 0件 | エラー: 0件
```

### 結果を確認

セットアップが完了すると:
- **自動設定されたもの**: Datadog の管理画面にダッシュボードやモニターが作成されます
- **手動手順書**: `~/.datadog-connect/output/` に手動で行う手順が出力されます

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npx datadog-connect setup` | セットアップウィザードを開始 |
| `npx datadog-connect resume` | 前回の失敗モジュールだけ再実行 |
| `npx datadog-connect rollback` | 作成したリソースを削除 |
| `npx datadog-connect mcp` | Datadog MCP サーバーを Claude Code に接続 |

## MCP接続（Claude Code 連携）

Datadog MCP サーバーを Claude Code に接続して、AI経由でDatadogを操作できます:

```bash
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"
npx datadog-connect mcp
```

接続後、Claude Code で:

```
「Datadogの直近のアラートを確認して」
「CPU使用率が高いホストを調べて」
「本番環境のエラーログを検索して」
「新しいモニターを作成して」
```

## 環境変数

毎回キーを入力するのが面倒な場合:

```bash
export DD_API_KEY="あなたのAPIキー"
export DD_APP_KEY="あなたのApplicationキー"
export DD_SITE="ap1.datadoghq.com"  # オプション（デフォルト: datadoghq.com）
npx datadog-connect setup
```

## トラブルシューティング

| 問題 | 解決方法 |
|------|---------|
| 認証エラー | API Key と Application Key が正しいか確認。3回まで再入力可 |
| サイトの選び方 | ログインURLで判別: `app.datadoghq.com` → US1、`ap1.datadoghq.com` → AP1 |
| 機能がスキップされた | Datadog プランで利用できない機能は自動スキップ |
| 途中で止まった | `npx datadog-connect resume` で失敗モジュールだけ再実行 |
| 設定を元に戻したい | `npx datadog-connect rollback` で作成リソースを削除 |
| ブラウザ自動取得の失敗 | 手動入力に自動で切り替わります |

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

## License

MIT
