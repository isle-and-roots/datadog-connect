import { confirm } from "@inquirer/prompts";
import { promptCredentials } from "./auth/key-manager.js";
import { createDatadogClient } from "./client/datadog-client.js";
import { loadLatestSession, loadSession } from "./state/state-manager.js";
import { loadJournal } from "./state/operation-journal.js";
import { deleteResource, SkipError } from "./lib/delete-resource.js";
import {
  printBanner,
  printSuccess,
  printError,
  printInfo,
} from "./utils/prompts.js";

export interface RollbackOptions {
  sessionId?: string;
}

export async function runRollback(opts: RollbackOptions): Promise<void> {
  printBanner();

  // セッション解決
  const session = opts.sessionId
    ? loadSession(opts.sessionId)
    : loadLatestSession();

  if (!session) {
    printError(
      opts.sessionId
        ? `セッション "${opts.sessionId}" が見つかりません。`
        : "ロールバック可能なセッションが見つかりません。"
    );
    process.exit(1);
  }

  // ジャーナル読み込み
  const journal = loadJournal(session.sessionId);
  if (!journal || journal.resources.length === 0) {
    printInfo(
      `セッション ${session.sessionId} にロールバック対象のリソースはありません。`
    );
    return;
  }

  const resources = [...journal.resources].reverse();

  console.log();
  console.log(
    `  セッション: ${session.sessionId} (${session.startedAt.slice(0, 10)})`
  );
  console.log(`  ロールバック対象: ${resources.length} リソース`);
  console.log();

  for (const r of resources) {
    console.log(`    • [${r.type}] ${r.name} (${r.id})`);
  }
  console.log();

  const ok = await confirm({
    message: "上記のリソースをすべて削除しますか？",
    default: false,
  });

  if (!ok) {
    printInfo("ロールバックをキャンセルしました。");
    return;
  }

  // 認証
  const creds = await promptCredentials(session.profile);
  const client = createDatadogClient(creds);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const resource of resources) {
    try {
      await deleteResource(client, resource);
      printSuccess(`削除完了: [${resource.type}] ${resource.name}`);
      succeeded++;
    } catch (err) {
      if (err instanceof SkipError) {
        printInfo(err.message);
        skipped++;
      } else {
        const message =
          err instanceof Error ? err.message : String(err);
        printError(`削除失敗: [${resource.type}] ${resource.name} — ${message}`);
        failed++;
      }
    }
  }

  console.log();
  console.log("  ─── ロールバック結果 ───────────────────────");
  console.log(`    削除成功: ${succeeded}`);
  console.log(`    スキップ: ${skipped}`);
  console.log(`    失敗    : ${failed}`);
  console.log("  ────────────────────────────────────────────");
  console.log();

  if (failed > 0) {
    printError("一部のリソースの削除に失敗しました。Datadog コンソールで確認してください。");
    process.exit(1);
  } else {
    printSuccess("ロールバック完了。");
  }
}
