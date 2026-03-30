import { checkbox, confirm } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { getBrowserController } from "./browser/browser-controller.js";
import { createDatadogClient } from "./client/datadog-client.js";
import { createSession, saveSession } from "./state/state-manager.js";
import { createJournal, addResource } from "./state/operation-journal.js";
import { getModules, resolveOrder } from "./modules/registry.js";
import { printBanner, printStep, printSuccess, printError, printInfo } from "./utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "./utils/spinner.js";
import { printSummary, exportSummary } from "./output/summary.js";
import { getSecureOutputDir } from "./utils/secure-write.js";
import type { BaseModule } from "./modules/base-module.js";
import type { ResourceRecord, ManualStep } from "./config/types.js";

// Register modules (side-effect imports)
import "./modules/cloud/aws.module.js";
import "./modules/cloud/gcp.module.js";
import "./modules/cloud/azure.module.js";
import "./modules/cloud/on-prem.module.js";
import "./modules/cloud/kubernetes.module.js";
import "./modules/cloud/xserver.module.js";
import "./modules/features/apm.module.js";
import "./modules/features/logs.module.js";
import "./modules/features/dashboards.module.js";
import "./modules/features/monitors.module.js";
import "./modules/features/synthetics.module.js";
import "./modules/security/cspm.module.js";
import "./modules/security/cws.module.js";
import "./modules/security/asm.module.js";
import "./modules/security/siem.module.js";
import "./modules/security/sensitive-data.module.js";

export async function runSetup(opts: { profile: string }): Promise<void> {
  printBanner();

  // Step 1: Auth
  const creds = await promptCredentials(opts.profile);
  const client = createDatadogClient(creds);

  // Create session & journal
  const session = createSession(creds.site, opts.profile);
  const journal = createJournal(session.sessionId);

  printInfo(`セッション: ${session.sessionId}`);
  console.log();

  // Step 2: Module selection
  printStep(2, "機能選択");
  const allModules = getModules();
  const selectedModules = await checkbox<BaseModule>({
    message: "どの機能を有効にしますか？",
    choices: allModules.map((m) => ({
      value: m,
      name: `${m.name} — ${m.description}`,
      checked: true,
    })),
  });

  if (selectedModules.length === 0) {
    printError("機能が選択されていません。終了します。");
    return;
  }

  // Resolve execution order
  const ordered = resolveOrder(selectedModules);

  // Step 3+: Execute each module
  const allResources: ResourceRecord[] = [];
  const allManualSteps: ManualStep[] = [];
  const allErrors: string[] = [];
  let stepNum = 3;

  for (const mod of ordered) {
    printStep(stepNum++, mod.name);

    // Initialize module state
    session.modules[mod.id] = {
      state: "pending",
      resources: [],
      errors: [],
    };

    // Preflight: エンタイトルメント事前検証（セキュリティモジュール用）
    if (mod.category === "security") {
      const preflight = await mod.preflight(client);
      if (!preflight.available) {
        printInfo(`${mod.name}: スキップ — ${preflight.reason ?? "利用不可"}`);
        mod.state = "skipped";
        session.modules[mod.id].state = "skipped";
        saveSession(session);
        console.log();
        continue;
      }
      printSuccess(`${mod.name}: 利用可能`);
    }

    // Prompt
    mod.state = "prompted";
    session.modules[mod.id].state = "prompted";
    let config;
    try {
      config = await mod.prompt();
      session.modules[mod.id].config = sanitizeConfig(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(`${mod.name} のヒアリング中にエラー: ${msg}`);
      mod.state = "failed";
      session.modules[mod.id].state = "failed";
      session.modules[mod.id].errors.push(msg);
      allErrors.push(`[${mod.name}] ${msg}`);
      saveSession(session);
      continue;
    }

    // Execute
    mod.state = "executing";
    session.modules[mod.id].state = "executing";
    startSpinner(`${mod.name} を設定中...`);

    try {
      const result = await mod.execute(config, client);

      if (result.success) {
        succeedSpinner(`${mod.name} 完了`);
        mod.state = "completed";
        session.modules[mod.id].state = "completed";
      } else {
        failSpinner(`${mod.name} 一部失敗`);
        mod.state = "failed";
        session.modules[mod.id].state = "failed";
      }

      // Record resources
      for (const r of result.resources) {
        addResource(journal, r);
        mod.createdResources.push(r);
        allResources.push(r);
        session.modules[mod.id].resources.push(r);
      }

      // Record manual steps
      mod.manualSteps = result.manualSteps;
      allManualSteps.push(...result.manualSteps);

      // Record errors
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map((e) => `[${mod.name}] ${e}`));
        session.modules[mod.id].errors = result.errors;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSpinner(`${mod.name} 失敗: ${msg}`);
      mod.state = "failed";
      session.modules[mod.id].state = "failed";
      session.modules[mod.id].errors.push(msg);
      allErrors.push(`[${mod.name}] ${msg}`);
    }

    saveSession(session);

    // Verify
    if (mod.state === "completed") {
      try {
        const verification = await mod.verify(client);
        if (verification.success) {
          printSuccess(`検証OK: ${verification.checks.filter((c) => c.passed).length}/${verification.checks.length} チェック通過`);
        } else {
          const failed = verification.checks.filter((c) => !c.passed);
          for (const c of failed) {
            printError(`検証NG: ${c.name} — ${c.detail ?? ""}`);
          }
        }
      } catch {
        // Verification failure is non-fatal
        printInfo("検証をスキップしました");
      }
    }

    console.log();
  }

  // Final summary
  const summaryData = {
    sessionId: session.sessionId,
    resources: allResources,
    manualSteps: allManualSteps,
    errors: allErrors,
  };

  printSummary(summaryData);

  const outputDir = getSecureOutputDir();
  const reportPath = exportSummary(summaryData, outputDir);
  printSuccess(`レポート出力: ${reportPath}`);

  if (allErrors.length > 0) {
    printInfo(`再実行: datadog-connect resume --session ${session.sessionId}`);
  }

  // 完了後ダッシュボード表示
  if (allResources.some((r) => r.type === "dashboard")) {
    const dashboardResource = allResources.find((r) => r.type === "dashboard");
    if (dashboardResource) {
      const browserCtrl = getBrowserController();
      if (await browserCtrl.isAvailable()) {
        const openDash = await confirm({
          message: "Datadogダッシュボードをブラウザで開きますか？",
          default: true,
        });
        if (openDash) {
          const ready = await browserCtrl.ensureBrowser();
          if (ready) {
            await browserCtrl.launch();
            const siteBase = session.site === "datadoghq.eu"
              ? "https://app.datadoghq.eu"
              : `https://app.${session.site}`;
            await browserCtrl.goto(`${siteBase}/dashboard/${dashboardResource.id}`);
            printSuccess("ダッシュボードを開きました！");
            // ブラウザは閉じない（ユーザーが確認するため）
          }
        }
      }
    }
  }
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
