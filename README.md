# Datadog Connect

**Datadog の監視設定を、AI が全部やってくれるツール。**

[![npm version](https://img.shields.io/npm/v/datadog-connect)](https://www.npmjs.com/package/datadog-connect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## これは何？

Datadog Connect は、[Datadog](https://www.datadoghq.com/)（サーバー監視サービス）の設定を **AI（Claude Code）に話しかけるだけ** で完了できるツールです。

従来、Datadog の設定には専門知識が必要でした。このツールを使えば：

```
あなた：「AWS 環境の監視をセットアップして」
  AI ：設定プランを作成 → 必要な手順書を自動生成
```

**技術知識がなくても、AI と対話するだけで監視環境を構築できます。**

---

## できること

| やりたいこと | 話しかけ方 |
|-------------|-----------|
| 監視の初期設定 | 「Datadog をセットアップして」 |
| 設定のおすすめを知りたい | 「うちの環境に合った監視設定を教えて」 |
| 障害の原因を調べたい | 「本番でエラーが出てるから調べて」 |
| 設定を見直したい | 「アラートが多すぎるから最適化して」 |
| 設定を元に戻したい | 「さっきの変更を戻して」 |

---

## はじめかた（3ステップ）

### Step 1: Datadog の API キーを用意する

Datadog にログイン → **Organization Settings** → **API Keys** から取得します。

```bash
# ターミナルで以下を実行（キーは自分のものに置き換え）
export DD_API_KEY="ここにAPIキーを貼り付け"
export DD_APP_KEY="ここにアプリケーションキーを貼り付け"
```

> **日本リージョンの方**: `export DD_SITE="ap1.datadoghq.com"` も追加してください

### Step 2: ツールを接続する

```bash
npx datadog-connect mcp
```

これだけで Claude Code と Datadog が繋がります。

### Step 3: AI に話しかける

Claude Code を開いて、日本語で指示するだけ：

```
「Datadog をセットアップして」
```

AI が環境を自動判別して、最適な設定プランを提案してくれます。

> **初めての方におすすめ**: `npx datadog-connect plan --preset minimal` で、モニター + ダッシュボードだけの最小セットアップを 5 分で体験できます。

---

## 主な機能

### 1. ガイド付きセットアップ

環境（AWS / GCP / Azure / Kubernetes など）を自動で検出して、最適な監視設定プランを提案。

**対応環境:**
- AWS（EC2, RDS, Lambda, ECS など）
- Google Cloud（GCE, GKE, Cloud Run など）
- Azure（VM, AKS, App Service など）
- Kubernetes（Helm / Operator）
- オンプレミス・VPS（Xserver 含む）

### 2. 監視ベストプラクティス

あなたのシステム構成に合わせて、「何を監視すべきか」を自動で提案：

- **アラート設定** — CPU、メモリ、ディスク、エラー率など 25 種類以上
- **ダッシュボード** — インフラ概要、APM、ログ分析など 5 種類
- **ログ管理** — Nginx / Apache / アプリログの自動パイプライン
- **セキュリティ** — 不正アクセス検知、脆弱性スキャン、WAF

### 3. 障害対応サポート

問題が起きたとき、AI が調査を手伝います：

```
「API のレスポンスが遅い原因を調べて」
→ メトリクス・ログ・トレースを横断的に分析
→ 原因の候補と対応手順を提示
→ 再発防止のアラート設定を提案
```

### 4. 監視の最適化

既存の設定を見直して改善ポイントを提案：

- 鳴りすぎてるアラートの検出
- 監視カバレッジの穴の発見
- ログのコスト削減提案

---

## コマンド一覧

ターミナルから直接使うこともできます：

| コマンド | 説明 |
|---------|------|
| `npx datadog-connect setup` | 対話形式でセットアップ |
| `npx datadog-connect plan` | 設定プランを生成して表示 |
| `npx datadog-connect resume` | 前回の途中から再開 |
| `npx datadog-connect rollback` | 作成した設定を元に戻す |
| `npx datadog-connect mcp` | Claude Code と Datadog を接続 |
| `npx datadog-connect sessions` | 過去のセッション一覧を表示 |

### 便利なオプション

```bash
# 5分で完了するクイックスタート
npx datadog-connect plan --preset minimal

# JSON形式で出力（スクリプト連携用）
npx datadog-connect setup --format json

# 削除前にプレビュー（安全確認）
npx datadog-connect rollback --dry-run

# 過去5件のセッションを表示
npx datadog-connect sessions --limit 5
```

---

## 仕組み

```
┌──────────────────────────────────────────────┐
│  あなた（自然言語で指示）                       │
│  「AWS の監視をセットアップして」                │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  Claude Code + Datadog Connect               │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ Knowledge   │  │ Plan Builder         │   │
│  │ (16モジュール │  │ (最適な手順を        │   │
│  │  の設定知識) │  │  自動で組み立て)     │   │
│  └─────────────┘  └──────────────────────┘   │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  公式 Datadog MCP                            │
│  (実際の API 操作を安全に実行)                 │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  Datadog                                     │
│  (ダッシュボード・アラート・ログが設定される)    │
└──────────────────────────────────────────────┘
```

**ポイント:**
- このツールが Datadog に直接アクセスすることはありません
- 公式の安全な経路（Datadog MCP）を通じて操作します
- API キーはツール内に保存されません

---

## 対応するセットアップ項目（16 モジュール）

<details>
<summary>クラウド連携（6 種類）</summary>

| 項目 | 内容 |
|------|------|
| AWS | IAM ロール作成 + CloudWatch 連携 |
| Google Cloud | サービスアカウント + Workload Identity |
| Azure | Reader ロール + サブスクリプション連携 |
| Kubernetes | Helm / Operator での Agent デプロイ |
| オンプレミス | Linux / Windows への Agent インストール |
| Xserver | VPS・専用サーバーの監視設定 |

</details>

<details>
<summary>監視機能（5 種類）</summary>

| 項目 | 内容 |
|------|------|
| APM | アプリケーション性能監視（7 言語対応） |
| ログ管理 | ログ収集パイプラインの自動設定 |
| ダッシュボード | 5 種類のプリセットダッシュボード |
| アラート | 25 種類以上のモニター定義 |
| 外形監視 | API テストの自動作成 |

</details>

<details>
<summary>セキュリティ（5 種類）</summary>

| 項目 | 内容 |
|------|------|
| CSPM | クラウドセキュリティ態勢管理 |
| CWS | ワークロード保護 |
| ASM | Web アプリケーション保護（WAF） |
| SIEM | セキュリティログ分析 |
| 機密データ | PII・クレジットカード番号の自動検出 |

</details>

---

## よくある質問

<details>
<summary>Q: Datadog のアカウントは必要ですか？</summary>

はい。[Datadog](https://www.datadoghq.com/) のアカウントと API キーが必要です。無料トライアルでも利用できます。
</details>

<details>
<summary>Q: 料金はかかりますか？</summary>

Datadog Connect 自体は**無料**（MIT ライセンス）です。Datadog の利用料金は別途発生します。
</details>

<details>
<summary>Q: セキュリティは大丈夫ですか？</summary>

- API キーはツール内に保存されません
- すべての操作は公式 Datadog MCP を経由します
- セキュリティルールは「検出のみ」モードで作成（ブロックしない）
- 作成した設定はいつでもロールバック（元に戻す）できます
</details>

<details>
<summary>Q: 設定を間違えたらどうなりますか？</summary>

`npx datadog-connect rollback` で、このツールが作成した設定をまとめて元に戻せます。手動で Datadog を操作する必要はありません。
</details>

<details>
<summary>Q: npx が使えません</summary>

Node.js v20 以上をインストールしてください。Mac の場合:
```bash
brew install node
```
</details>

<details>
<summary>Q: 途中でエラーになりました</summary>

`npx datadog-connect resume` で、成功したところから続行できます。最初からやり直す必要はありません。
</details>

---

## 動作環境

- **Node.js** 20 以上
- **Claude Code**（[公式サイト](https://claude.ai/code)）
- **Datadog アカウント** + API キー

### 環境変数（オプション）

| 変数 | 説明 | 例 |
|------|------|-----|
| `DD_API_KEY` | Datadog API キー（32文字） | `abcdef1234567890...` |
| `DD_APP_KEY` | Datadog Application キー（40文字） | `abcdef1234567890...` |
| `DD_SITE` | Datadog サイト | `ap1.datadoghq.com`（日本） |
| `DD_ASCII` | ASCII モード（絵文字なし出力） | `1` |

---

## 開発者向け情報

<details>
<summary>技術詳細（クリックで展開）</summary>

### Tech Stack
- TypeScript + tsup (ESM)
- Commander.js (CLI)
- Zod (入力バリデーション)
- Playwright (オプション: ブラウザ自動化)

### Architecture
```
src/
  knowledge/     — 16モジュールのドメイン知識（純粋データ）
  orchestrator/  — MCP呼び出しプラン生成エンジン
  modules/       — cloud(6) + feature(5) + security(5)
  state/         — セッション永続化 + リソースジャーナル
  browser/       — Playwright ブラウザ自動化（オプション）
skills/          — Claude Code スキル定義（5スキル）
```

### Security Design
- State directory: `0o700`, files: `0o600`
- Credentials sanitized before session persistence
- API keys passed via process env (not command args)
- PowerShell/YAML injection protection in generated scripts
- ASM/WAF rules created in monitor-only mode
- Pre-flight validation catches invalid keys before setup starts

### Build & Test
```bash
npm run typecheck   # TypeScript 型チェック
npm run build       # tsup ビルド
```

### Accessibility
- `DD_ASCII=1` — emoji-free ASCII output for restricted terminals
- Terminal width auto-detection for responsive formatting
- Color + text prefix indicators for color-blind accessibility

</details>

---

## ライセンス

MIT License - [Isle and Roots Inc.](https://github.com/isle-and-roots)
