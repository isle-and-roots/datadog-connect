# トラブルシューティング

## 認証エラー

**症状**: 「認証失敗」と表示される

**対処**:
1. API Key が正しいか確認: Datadog > Organization Settings > API Keys
2. Application Key が正しいか確認: Organization Settings > Application Keys
3. Datadogサイトが正しいか確認: ログインURLが `app.datadoghq.com` なら US1、`ap1.datadoghq.com` なら AP1
4. 3回まで再入力可能です

## 機能がスキップされた

**症状**: 「スキップ — Enterpriseプランが必要」と表示される

**対処**: セキュリティ機能（CSPM/CWS/ASM/SIEM/SDS）はDatadog Enterprise以上のプランが必要です。スキップされても他の機能は正常に動作します。

## ブラウザ自動取得が失敗する

**症状**: 「自動取得できませんでした」と表示される

**対処**: 手動入力に自動で切り替わります。もしブラウザ自体が起動しない場合:
```bash
npx playwright install chromium
```

## 途中で止まった

**対処**:
```bash
npm run resume    # 失敗モジュールだけ再実行
```

## 設定を元に戻したい

**対処**:
```bash
npm run rollback  # 作成リソースを削除
```

一部のリソース（クラウド統合等）は手動削除が必要です。画面に表示される手順に従ってください。

## GCP統合でエラーが出る

**よくある原因**:
1. Project ID が正しくない（英小文字・数字・ハイフン、6-30文字）
2. サービスアカウントが未作成 — 手順書に従って `gcloud` コマンドで作成
3. Datadog 側の権限不足 — API Key に十分な権限があるか確認

## Xserverでファイアウォール設定が失敗する

**対処**: Xserver管理画面で手動設定してください:
- TCP 443 アウトバウンド許可（`*.datadoghq.com` 宛）
