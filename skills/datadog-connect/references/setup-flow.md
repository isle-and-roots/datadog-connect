# セットアップフロー

## 実行コマンド

```bash
cd ${CLAUDE_PLUGIN_ROOT}
npm run setup
```

## フロー全体

```
Step 1: 認証
  ├── 環境変数 (DD_API_KEY/DD_APP_KEY) → 自動スキップ
  ├── ブラウザ自動取得 → ログインするだけでOK
  └── 手動入力 → 3回リトライ可能

Step 2: セットアップタイプ
  ⭐ おすすめセット — ダッシュボード + モニター + ログ
  ☁️  AWS環境向け — AWS + モニター + ダッシュボード + APM
  ☁️  GCP環境向け — GCP + モニター + ダッシュボード + APM + ログ
  🔒 セキュリティ重視 — CSPM + CWS + ASM + SIEM + SDS
  🖥️  Xserver向け — Xserver + モニター + ダッシュボード
  🚀 フル — 全17モジュール
  ⚙️  カスタム — Cloud/Feature/Security カテゴリ別に選択

Step 3+: 各モジュール設定 [1/N]
  各モジュールが順番に質問 → API実行 → 検証

完了: レポート出力 + 次のステップ案内
```

## セキュリティモジュールの特別フロー

セキュリティモジュール（CSPM/CWS/ASM/SIEM/SDS）は実行前に:
1. **Preflight**: APIプローブでDatadogプランを確認
2. 非対応プラン → 自動スキップ（エラーにならない）
3. ASM/WAF → **monitorモード**（検出のみ、ブロックしない）で作成

## 出力ファイル

全て `~/.datadog-connect/output/` に保存:
- `setup-report.json` — 作成リソース一覧
- `manual-steps.md` — 手動で行う手順書
- クラウド別スクリプト（IAMロール、gcloud設定等）
