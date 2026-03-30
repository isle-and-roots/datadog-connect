import { confirm } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { createDatadogClient } from "./client/datadog-client.js";
import { loadLatestSession, loadSession, saveSession } from "./state/state-manager.js";
import { getModules } from "./modules/registry.js";
import { printBanner, printStep, printSuccess, printError, printInfo } from "./utils/prompts.js";
import { startSpinner, succeedSpinner, failSpinner } from "./utils/spinner.js";

// Register modules (side-effect imports) — wizard.ts と同じ順序で登録
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

interface ResumeOptions {
  sessionId?: string;
}

export async function runResume(opts: ResumeOptions): Promise<void> {
  printBanner();
  printStep(1, "セッション復元");

  const session = opts.sessionId
    ? loadSession(opts.sessionId)
    : loadLatestSession();

  if (!session) {
    printError("復元可能なセッションが見つかりません。");
    printInfo("datadog-connect setup で新しいセッションを開始してください。");
    return;
  }

  // 失敗/スキップされたモジュールを抽出
  const failedModules = Object.entries(session.modules)
    .filter(([, m]) => m.state === "failed" || m.state === "skipped")
    .map(([id, m]) => ({ id, state: m.state, errors: m.errors }));

  const completedModules = Object.entries(session.modules)
    .filter(([, m]) => m.state === "completed")
    .map(([id]) => id);

  printInfo(`セッション: ${session.sessionId}`);
  printInfo(`開始日時: ${session.startedAt}`);
  printSuccess(`完了済み: ${completedModules.length}モジュール`);

  if (failedModules.length === 0) {
    printSuccess("全モジュールが完了済みです。再実行の必要はありません。");
    return;
  }

  printError(`未完了: ${failedModules.length}モジュール`);
  for (const mod of failedModules) {
    const errSuffix = mod.errors.length > 0 ? `: ${mod.errors[0]}` : "";
    printInfo(`  - ${mod.id} (${mod.state})${errSuffix}`);
  }

  const shouldResume = await confirm({
    message: `${failedModules.length}件の未完了モジュールを再実行しますか？`,
    default: true,
  });

  if (!shouldResume) return;

  // 認証
  printStep(2, "認証");
  const creds = await promptCredentials(session.profile);
  const client = createDatadogClient(creds);

  // 失敗モジュールを再実行
  const allModules = getModules();
  let step = 3;

  for (const failed of failedModules) {
    const mod = allModules.find((m) => m.id === failed.id);
    if (!mod) {
      printInfo(`  - ${failed.id}: モジュールが見つかりません。スキップします。`);
      continue;
    }

    printStep(step++, `${mod.name} (再実行)`);

    // セキュリティモジュールの preflight 検証
    if (mod.category === "security") {
      const preflight = await mod.preflight(client);
      if (!preflight.available) {
        printInfo(`${mod.name}: スキップ — ${preflight.reason ?? "利用不可"}`);
        continue;
      }
    }

    try {
      const config = await mod.prompt();
      startSpinner(`${mod.name} を設定中...`);
      const result = await mod.execute(config, client);

      if (result.success) {
        succeedSpinner(`${mod.name} 完了`);
        session.modules[failed.id].state = "completed";
        session.modules[failed.id].errors = [];
        if (result.resources.length > 0) {
          session.modules[failed.id].resources.push(...result.resources);
        }
      } else {
        failSpinner(`${mod.name} 失敗`);
        session.modules[failed.id].state = "failed";
        if (result.errors.length > 0) {
          session.modules[failed.id].errors = result.errors;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failSpinner(`${mod.name} 失敗: ${msg}`);
      session.modules[failed.id].state = "failed";
      session.modules[failed.id].errors = [msg];
    }

    saveSession(session);
    console.log();
  }

  // 再実行後のサマリー
  const stillFailed = Object.entries(session.modules)
    .filter(([, m]) => m.state === "failed")
    .map(([id]) => id);

  if (stillFailed.length === 0) {
    printSuccess("全モジュールの再実行が完了しました。");
  } else {
    printError(`再実行後も失敗しているモジュール: ${stillFailed.join(", ")}`);
    printInfo(`再度試す場合: datadog-connect resume --session ${session.sessionId}`);
  }
}
