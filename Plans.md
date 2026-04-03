# Plans — datadog-connect → Datadog MCP Harness ピボット

Updated: 2026-04-03

## 完了済み (v0.2.2)

- [x] Phase 1: NPM公開 (v0.1.0 → v0.2.2) `cc:done`
- [x] GCPモジュール バグ修正 `cc:done`
- [x] CX改善: 進捗表示 + サマリ + resumeコマンド `cc:done`
- [x] ブラウザ自動取得オプション統合 `cc:done`

---

## Phase 1: ナレッジ層の抽出

- [ ] Task 1.1: src/knowledge/ ディレクトリ作成 + monitor-packs.ts（monitors.module.ts から30+モニター定義を純粋データとして抽出）
- [ ] Task 1.2: dashboard-specs.ts（dashboards.module.ts からウィジェット定義を抽出）
- [ ] Task 1.3: security-rules.ts（SIEM/CWS/ASM/CSPM/Sensitive Data ルール定義を5つのセキュリティモジュールから抽出）
- [ ] Task 1.4: cloud-configs.ts（AWS/GCP/Azure/K8s/Xserver/On-Prem 統合設定を6つのクラウドモジュールから抽出）
- [ ] Task 1.5: presets.ts（wizard.ts + setup-tool.ts に散在するプリセット定義を統合）+ apm-guides.ts（7言語APMガイド抽出）
- [ ] Task 1.6: 各module.tsからknowledge/へのimport切り替え + typecheck & build 検証

## Phase 2: オーケストレーション層の構築

- [ ] Task 2.1: src/orchestrator/mcp-call.ts 型定義（McpToolCall, ExecutionPlan, ModulePlan）
- [ ] Task 2.2: BaseModule インターフェース変更（execute/verify/preflight → plan() メソッド）
- [ ] Task 2.3: plan-builder.ts（プリセット + モジュール設定 → ExecutionPlan 生成、registry.ts トポロジカルソート活用）
- [ ] Task 2.4: plan-renderer.ts（ExecutionPlan → Markdown ランブック + JSON 出力）
- [ ] Task 2.5: rollback-planner.ts（ジャーナル ResourceRecord → 逆順 MCP 呼び出し計画）
- [ ] Task 2.6: 16モジュール全てに plan() メソッド実装（knowledge/ データを使用）

## Phase 3: 直接API層の削除

- [x] Task 3.1: src/client/datadog-client.ts + src/mcp-server.ts + src/mcp-tools/*.ts + src/lib/delete-resource.ts 削除 `cc:done`
- [x] Task 3.2: package.json から @datadog/datadog-api-client と @modelcontextprotocol/sdk を削除 + bin から datadog-connect-mcp 削除 `cc:done`
- [x] Task 3.3: tsup.config.ts から mcp-server.ts エントリ削除 + auth/key-manager.ts からAPIバリデーション削除 `cc:done`
- [x] Task 3.4: 全ソースから旧import参照を除去 + typecheck & build 検証 `cc:done`

## Phase 4: CLI リライト

- [x] Task 4.1: src/index.ts コマンド変更（setup→プラン生成, plan コマンド追加, mcp --self 削除） `cc:done`
- [x] Task 4.2: wizard.ts リライト（createDatadogClient() 削除 → プラン生成 + Markdown ランブック出力） `cc:done`
- [x] Task 4.3: resume.ts + rollback.ts リライト（プラン生成ベースに変更） `cc:done`

## Phase 5: スキル層の構築

- [x] Task 5.1: skills/datadog-connect/SKILL.md をハーネスとして書き換え + リファレンス更新
- [x] Task 5.2: skills/dd-setup/ スキル作成（環境自動検出 → プリセット推奨 → MCP呼び出しプラン生成）+ references/
- [x] Task 5.3: skills/dd-bestpractice/ スキル作成（スタック別モニター/ダッシュボード推奨）+ references/
- [x] Task 5.4: skills/dd-incident/ スキル作成（インシデント対応プレイブック）+ references/
- [x] Task 5.5: skills/dd-audit/ スキル作成（カバレッジ分析 + ノイズ分析 + コスト最適化）+ references/

## Phase 6: パッケージ更新 & 公開

- [x] Task 6.1: package.json version → 1.0.0 + description変更 + keywords追加 + plugin.json更新 `cc:done`
- [x] Task 6.2: README.md 全面リライト（ハーネスとしてのポジショニング） `cc:done`
- [ ] Task 6.3: 最終 typecheck & build & 動作確認

---

## Phase 7: 監査指摘修正 (Critical + High)

### Critical (5件)
- [x] Fix B1: presets.ts のモニターパックID "INFRA_PACK" → "infra" に修正 `cc:done`
- [x] Fix B2: PresetId + PRESET_MODULE_MAP に "azure" プリセット追加 `cc:done`
- [x] Fix B3: rollback.ts の二重 .reverse() を修正（rollback-planner.ts 側のみに統一） `cc:done`
- [x] Fix S1: sanitizeConfig() を saveSession() 前に呼び出し + Azure clientSecret の永続化防止 `cc:done`
- [x] Fix S2: mcp-setup.ts で DD_API_KEY/DD_APP_KEY を env 経由で渡す（引数配列から除去） `cc:done`

### High (9件)
- [x] Fix B4: 全モジュールの plan() MCP ツール名を datadog_* プレフィックス統一 + rollback-planner mapping 修正 `cc:done`
- [x] Fix B5: sensitive-data plan() の {{placeholder}} をユーザー向け説明に置換 `cc:done`
- [x] Fix B6: wizard/plan/resume の重複モジュール登録を modules/all.ts に統一 `cc:done`
- [x] Fix B7: CLI ヘルプとエラーメッセージのプリセット一覧を正確に修正 `cc:done`
- [x] Fix S3: state-manager.ts + operation-journal.ts の mkdirSync に mode: 0o700 追加 `cc:done`
- [x] Fix S6: cloud-configs.ts の PowerShell スクリプト生成にエスケープ追加 `cc:done`
- [x] Fix S7: cloud-configs.ts の YAML タグにクォート追加 `cc:done`
- [x] Fix P1: モジュール登録を all.ts に統一（B6 と統合） `cc:done`
- [x] Fix S13: plan.ts の --output に writeSecureFile を使用 `cc:done`
