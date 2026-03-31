import { loadLatestSession, loadSession } from "../state/state-manager.js";
import { loadJournal } from "../state/operation-journal.js";
import { mcpSessionArgsSchema } from "../config/schema.js";

export const STATUS_TOOL_DEF = {
  name: "datadog_status",
  description: "Datadog Connect のセッション状態を確認します。直近のセットアップ結果、作成済みリソース、失敗モジュールを表示。",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "セッションID（省略時は最新のセッション）",
      },
    },
  },
};

export async function statusTool(args: Record<string, unknown>) {
  const parsed = mcpSessionArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `入力エラー: ${parsed.error.issues.map((i) => i.message).join(", ")}` }],
      isError: true,
    };
  }

  const sessionId = parsed.data.session_id;
  const session = sessionId ? loadSession(sessionId) : loadLatestSession();

  if (!session) {
    return {
      content: [
        {
          type: "text" as const,
          text: sessionId
            ? `セッション "${sessionId}" が見つかりません。`
            : "セッションが見つかりません。まだセットアップを実行していません。",
        },
      ],
    };
  }

  const journal = loadJournal(session.sessionId);
  const resources = journal?.resources ?? [];

  const lines = [
    `セッション: ${session.sessionId}`,
    `サイト: ${session.site}`,
    `開始: ${session.startedAt}`,
    ``,
    `--- モジュール状態 ---`,
  ];

  for (const [id, mod] of Object.entries(session.modules)) {
    const icon = mod.state === "completed" ? "✅" : mod.state === "failed" ? "❌" : mod.state === "skipped" ? "⏭️" : "⏳";
    lines.push(`  ${icon} ${id}: ${mod.state} (リソース: ${mod.resources.length}件, エラー: ${mod.errors.length}件)`);
  }

  if (resources.length > 0) {
    lines.push(``, `--- 作成済みリソース (${resources.length}件) ---`);
    for (const r of resources) {
      lines.push(`  • [${r.type}] ${r.name} (${r.id})`);
    }
  }

  const failedModules = Object.entries(session.modules)
    .filter(([, m]) => m.state === "failed")
    .map(([id]) => id);

  if (failedModules.length > 0) {
    lines.push(``, `--- 再実行可能 ---`);
    lines.push(`失敗モジュール: ${failedModules.join(", ")}`);
    lines.push(`→ datadog_resume ツールで再実行できます`);
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
