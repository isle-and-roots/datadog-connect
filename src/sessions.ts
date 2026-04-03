import chalk from "chalk";
import { listSessions } from "./state/state-manager.js";

export async function runSessions(opts: { limit?: number }): Promise<void> {
  const limit = opts.limit ?? 10;
  const sessions = listSessions(limit);

  if (sessions.length === 0) {
    console.log(chalk.dim("  セッションが見つかりません。"));
    console.log(chalk.dim("  datadog-connect setup で新しいセッションを開始してください。"));
    return;
  }

  console.log();
  console.log(chalk.bold.cyan("  セッション一覧"));
  console.log(chalk.dim("  " + "─".repeat(60)));
  console.log();

  // Header row
  const col = {
    id: 8,
    date: 20,
    site: 16,
    preset: 12,
    modules: 8,
    status: 10,
  };

  const header = [
    "ID".padEnd(col.id),
    "作成日時".padEnd(col.date),
    "サイト".padEnd(col.site),
    "プロファイル".padEnd(col.preset),
    "モジュール".padEnd(col.modules),
    "ステータス",
  ].join("  ");
  console.log(chalk.bold("  " + header));
  console.log(chalk.dim("  " + "─".repeat(header.length)));

  for (const s of sessions) {
    const dateStr = formatDate(s.createdAt);
    const statusStr = formatStatus(s.status);

    const row = [
      chalk.cyan(s.shortId.padEnd(col.id)),
      chalk.white(dateStr.padEnd(col.date)),
      chalk.dim(s.site.padEnd(col.site)),
      chalk.dim(s.profile.padEnd(col.preset)),
      chalk.dim(String(s.moduleCount).padEnd(col.modules)),
      statusStr,
    ].join("  ");

    console.log("  " + row);
  }

  console.log();
  console.log(chalk.dim(`  合計 ${sessions.length} 件のセッション (最新${limit}件表示)`));
  console.log(chalk.dim("  再開: datadog-connect resume --session <ID>"));
  console.log();
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function formatStatus(status: "completed" | "partial" | "pending"): string {
  switch (status) {
    case "completed":
      return chalk.green("完了");
    case "partial":
      return chalk.yellow("一部完了");
    case "pending":
      return chalk.dim("未実行");
  }
}
