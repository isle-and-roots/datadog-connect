import { checkbox, select } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { createSession, saveSession } from "./state/state-manager.js";
import { getModules } from "./modules/registry.js";
import { printBanner, printStep, printSuccess, printError, printInfo } from "./utils/prompts.js";
import chalk from "chalk";
import { getSecureOutputDir, writeSecureFile } from "./utils/secure-write.js";
import { PRESET_META, PRESET_MODULE_MAP, CUSTOM_WIZARD_DEFAULTS } from "./knowledge/presets.js";
import { buildExecutionPlanFromIds } from "./orchestrator/plan-builder.js";
import { renderPlanAsMarkdown, renderPlanAsJson, renderPostSetupSummary } from "./orchestrator/plan-renderer.js";
import { runPreflight, printPreflightResult, hasApiKeyFormatError } from "./utils/preflight.js";
import type { BaseModule } from "./modules/base-module.js";
import { join } from "node:path";

// Register modules (side-effect imports)
import "./modules/all.js";

export async function runSetup(opts: { profile: string; format?: string }): Promise<void> {
  printBanner();

  // Pre-flight checks
  const preflightResult = runPreflight();
  if (preflightResult.checks.length > 0) {
    printPreflightResult(preflightResult);
    if (hasApiKeyFormatError(preflightResult)) {
      printError(
        "APIキーのフォーマットが正しくありません。環境変数を確認してから再実行してください。"
      );
      printInfo("  export DD_API_KEY=\"32文字の16進数\"");
      printInfo("  export DD_APP_KEY=\"40文字の16進数\"");
      return;
    }
  }

  // Step 1: Auth (format validation only in MCP Harness mode)
  const creds = await promptCredentials(opts.profile);

  // Create session for tracking (sanitize module configs before persisting)
  const session = createSession(creds.site, opts.profile);
  saveSessionSanitized(session);

  printInfo(`セッション: ${session.sessionId}`);
  console.log();

  // Step 2: セットアップタイプ選択
  printStep(2, "セットアップタイプ");

  const allModules = getModules();

  const presetChoice = await select({
    message: "セットアップタイプを選んでください:",
    choices: PRESET_META.map((p) => ({
      value: p.id,
      name: `${p.label} — ${p.description}`,
    })),
  });

  let selectedModules: BaseModule[];

  if (presetChoice === "custom") {
    // カテゴリ別の段階的選択
    const cloudModules = allModules.filter((m) => m.category === "cloud");
    const featureModules = allModules.filter((m) => m.category === "feature");
    const securityModules = allModules.filter((m) => m.category === "security");

    printStep(2, "クラウド環境");
    const selectedCloud = await checkbox<BaseModule>({
      message: "使用しているクラウド環境:",
      choices: cloudModules.map((m) => ({
        value: m,
        name: `${m.name} — ${m.description}`,
        checked: false,
      })),
    });

    printStep(2, "監視機能");
    const selectedFeature = await checkbox<BaseModule>({
      message: "有効にする監視機能:",
      choices: featureModules.map((m) => ({
        value: m,
        name: `${m.name} — ${m.description}`,
        checked: CUSTOM_WIZARD_DEFAULTS[m.id] ?? false,
      })),
    });

    printStep(2, "セキュリティ");
    const selectedSecurity = await checkbox<BaseModule>({
      message: "有効にするセキュリティ機能:",
      choices: securityModules.map((m) => ({
        value: m,
        name: `${m.name} — ${m.description}`,
        checked: false,
      })),
    });

    selectedModules = [...selectedCloud, ...selectedFeature, ...selectedSecurity];
  } else {
    // プリセットに基づくモジュール選択
    const presetIds: Record<string, string[]> = {
      ...PRESET_MODULE_MAP,
      full: allModules.map((m) => m.id),
    };

    const ids = new Set(presetIds[presetChoice] ?? []);
    selectedModules = allModules.filter((m) => ids.has(m.id));

    // プリセットの内容を表示
    printInfo(`選択されたモジュール: ${selectedModules.map((m) => m.name).join(", ")}`);
  }

  if (selectedModules.length === 0) {
    printError("機能が選択されていません。終了します。");
    return;
  }

  // Step 3: プランを生成（APIは呼び出さない）
  printStep(3, "実行プランを生成");

  const moduleIds = selectedModules.map((m) => m.id);

  let plan;
  try {
    plan = buildExecutionPlanFromIds({
      moduleIds,
      site: creds.site,
      sessionId: session.sessionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(`プラン生成に失敗しました: ${msg}`);
    return;
  }

  const useJson = opts.format === "json";
  const output = useJson ? renderPlanAsJson(plan) : renderPlanAsMarkdown(plan);
  const ext = useJson ? "json" : "md";

  // 出力先に保存
  const outputDir = getSecureOutputDir();
  const reportPath = join(outputDir, `setup-${session.sessionId.slice(0, 8)}.${ext}`);
  writeSecureFile(reportPath, output);

  console.log();
  console.log(output);
  console.log();
  printSuccess(`実行プランを保存しました: ${reportPath}`);

  // セットアップ完了サマリー（Datadog管理画面URL付き）
  const summary = renderPostSetupSummary(plan);
  console.log(summary);
}

/** セッション保存前にcredential系フィールドを除去 */
const SENSITIVE_KEYS = new Set([
  "clientSecret", "apiKey", "appKey", "secretKey",
  "accessKey", "password", "token", "credential",
]);

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/** セッションのモジュール設定からcredentialを除去してからセッションを保存する */
export function saveSessionSanitized(session: Parameters<typeof saveSession>[0]): void {
  for (const mod of Object.values(session.modules)) {
    if (mod.config) {
      mod.config = sanitizeConfig(mod.config);
    }
  }
  saveSession(session);
}
