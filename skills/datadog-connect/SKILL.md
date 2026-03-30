---
name: datadog-connect
description: "Datadogの全機能をワンコマンドでセットアップするウィザード。Use when user mentions Datadog setup, Datadog monitoring, Datadog configure, Datadog integration, monitoring setup, observability setup, AWS/GCP/Azure monitoring, Xserver monitoring, CSPM, WAF, SIEM setup. Trigger: 'Datadogをセットアップ', 'Datadog設定して', 'monitoring設定', 'Datadog connect'. Do NOT load for: Datadog API queries, checking alerts, viewing dashboards, existing monitoring data."
description-ja: "Datadogの全機能をワンコマンドでセットアップ。16モジュール対応（Cloud 6/Feature 5/Security 5）+ ブラウザ自動取得。"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
argument-hint: "[setup|resume|rollback|mcp]"
---

# Datadog Connect

Datadogの全機能を対話形式でセットアップするCLIウィザード。

## Quick Reference

| コマンド | 説明 |
|---------|------|
| `/datadog-connect setup` | セットアップウィザード |
| `/datadog-connect resume` | 前回の失敗モジュールを再実行 |
| `/datadog-connect rollback` | 作成リソースを削除 |
| `/datadog-connect mcp` | Datadog MCP サーバーを接続 |

## 実行方法

プラグインとして登録済みの場合、`npx` または `npm run` で実行できます。

### セットアップ

```bash
npx datadog-connect setup
```

または（プラグインルートから直接）:

```bash
cd ${CLAUDE_PLUGIN_ROOT}
npm run setup
```

ウィザードが起動し、以下の流れで進みます:
1. **認証**: ブラウザ自動取得 or 手動入力（3回リトライ可）
2. **プリセット選択**: おすすめ / AWS / GCP / セキュリティ / Xserver / フル / カスタム
3. **各モジュール設定**: 対話形式で質問に回答
4. **自動実行**: Datadog APIで設定を適用
5. **完了レポート**: 作成リソース一覧 + 手動手順書

詳細: [references/setup-flow.md](references/setup-flow.md)

### 引数なしで呼ばれた場合

ユーザーの意図を確認:
- 「セットアップしたい」→ `npm run setup`
- 「前回の続き」→ `npm run resume`
- 「設定を戻したい」→ `npm run rollback`
- 「Claude Codeから操作したい」→ `npm run mcp`

## 対応モジュール

**Cloud (6)**: AWS, GCP, Azure, On-Prem, Kubernetes, Xserver
**Feature (5)**: APM, Logs, Dashboards, Monitors, Synthetics
**Security (5)**: CSPM, CWS, ASM (monitor mode), SIEM, Sensitive Data Scanner

詳細: [references/presets.md](references/presets.md)

## ブラウザ自動取得

Playwright でログインするだけで各サービスの情報を自動取得:
- Datadog API Key / Application Key
- AWS Account ID / GCP Project ID / Azure Subscription ID
- Xserver VPS情報 + ファイアウォール自動設定

詳細: [references/browser-guide.md](references/browser-guide.md)

## トラブルシューティング

[references/troubleshoot.md](references/troubleshoot.md) を参照。
