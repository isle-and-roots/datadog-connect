# IaC/Terraform 検出ルール

## 検出パターン

| ファイル/パターン | 意味 |
|------------------|------|
| `*.tf` | Terraform 設定ファイル |
| `terraform/` ディレクトリ | Terraform プロジェクト |
| `datadog_monitor` リソース | Terraform で管理された Datadog モニター |
| `datadog_dashboard` リソース | Terraform で管理された Datadog ダッシュボード |
| `pulumi.yaml` | Pulumi プロジェクト |

## 検出時の対応

1. **警告を表示**: 「Terraform/IaC で管理されたリソースが検出されました。MCP で作成したリソースと競合する可能性があります。」
2. **推奨**: Terraform state と競合しないよう、異なるタグ prefix を使用
3. **代替案**: プランを Terraform HCL として出力 (将来機能)
