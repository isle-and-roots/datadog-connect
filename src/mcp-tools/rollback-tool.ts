import { createDatadogClient } from "../client/datadog-client.js";
import { loadLatestSession, loadSession } from "../state/state-manager.js";
import { loadJournal } from "../state/operation-journal.js";
import { deleteResource, SkipError } from "../lib/delete-resource.js";
import { mcpRollbackArgsSchema } from "../config/schema.js";
import type { DatadogSite } from "../config/types.js";

export const ROLLBACK_TOOL_DEF = {
  name: "datadog_rollback",
  description: "作成したリソースを削除（ロールバック）します。confirm: true が必須。認証はDD_API_KEY/DD_APP_KEY環境変数。",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "ロールバックするセッションID（省略時は最新）",
      },
      confirm: {
        type: "boolean",
        description: "削除の確認。true でないと実行されない（安全装置）",
      },
    },
    required: ["confirm"],
  },
};

export async function rollbackTool(args: Record<string, unknown>) {
  const parsed = mcpRollbackArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `入力エラー: ${parsed.error.issues.map((i) => i.message).join(", ")}` }],
      isError: true,
    };
  }

  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) {
    return {
      content: [{ type: "text" as const, text: "エラー: DD_API_KEY と DD_APP_KEY 環境変数が必要です。" }],
      isError: true,
    };
  }

  const sessionId = parsed.data.session_id;
  const session = sessionId ? loadSession(sessionId) : loadLatestSession();

  if (!session) {
    return {
      content: [{ type: "text" as const, text: "ロールバック可能なセッションが見つかりません。" }],
      isError: true,
    };
  }

  const journal = loadJournal(session.sessionId);
  if (!journal || journal.resources.length === 0) {
    return {
      content: [{ type: "text" as const, text: `セッション ${session.sessionId} にロールバック対象のリソースはありません。` }],
    };
  }

  const site = session.site as DatadogSite;
  const client = createDatadogClient({ site, apiKey, appKey, profile: "mcp" });
  const resources = [...journal.resources].reverse();

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const details: string[] = [];

  for (const resource of resources) {
    try {
      await deleteResource(client, resource);
      details.push(`✅ 削除: [${resource.type}] ${resource.name}`);
      succeeded++;
    } catch (err) {
      if (err instanceof SkipError) {
        details.push(`⏭️ スキップ: ${err.message}`);
        skipped++;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        details.push(`❌ 失敗: [${resource.type}] ${resource.name} — ${msg}`);
        failed++;
      }
    }
  }

  const summary = [
    `セッション: ${session.sessionId}`,
    ``,
    `削除成功: ${succeeded}件`,
    `スキップ: ${skipped}件`,
    `失敗: ${failed}件`,
    ``,
    ...details,
  ];

  return {
    content: [{ type: "text" as const, text: summary.join("\n") }],
    isError: failed > 0,
  };
}
