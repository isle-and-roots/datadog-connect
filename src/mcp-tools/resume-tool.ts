import { createDatadogClient } from "../client/datadog-client.js";
import { loadLatestSession, loadSession, saveSession } from "../state/state-manager.js";
import { loadJournal, addResource } from "../state/operation-journal.js";
import { getModules } from "../modules/registry.js";
import type { DatadogSite } from "../config/types.js";

// Module imports are handled by setup-tool.ts (shared registration)

export const RESUME_TOOL_DEF = {
  name: "datadog_resume",
  description: "前回失敗したモジュールを再実行します。セッションIDを省略すると最新のセッションを使用。認証はDD_API_KEY/DD_APP_KEY環境変数。",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "再実行するセッションID（省略時は最新）",
      },
      module_configs: {
        type: "object",
        description: "再実行時のモジュール設定（省略時は前回と同じ）",
        additionalProperties: true,
      },
    },
  },
};

export async function resumeTool(args: Record<string, unknown>) {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) {
    return {
      content: [{ type: "text" as const, text: "エラー: DD_API_KEY と DD_APP_KEY 環境変数が必要です。" }],
      isError: true,
    };
  }

  const sessionId = args.session_id as string | undefined;
  const session = sessionId ? loadSession(sessionId) : loadLatestSession();

  if (!session) {
    return {
      content: [{ type: "text" as const, text: "再実行可能なセッションが見つかりません。" }],
      isError: true,
    };
  }

  const failedModuleIds = Object.entries(session.modules)
    .filter(([, m]) => m.state === "failed")
    .map(([id]) => id);

  if (failedModuleIds.length === 0) {
    return {
      content: [{ type: "text" as const, text: `セッション ${session.sessionId} に失敗モジュールはありません。全て成功済みです。` }],
    };
  }

  const site = session.site as DatadogSite;
  const client = createDatadogClient({ site, apiKey, appKey, profile: "mcp" });
  const journal = loadJournal(session.sessionId);
  const moduleConfigs = (args.module_configs as Record<string, Record<string, unknown>>) ?? {};

  const allModules = getModules();
  const results: string[] = [
    `セッション: ${session.sessionId}`,
    `再実行対象: ${failedModuleIds.join(", ")}`,
    ``,
  ];

  for (const modId of failedModuleIds) {
    const mod = allModules.find((m) => m.id === modId);
    if (!mod) {
      results.push(`⏭️ ${modId}: モジュールが見つかりません`);
      continue;
    }

    const config = moduleConfigs[modId] ?? session.modules[modId]?.config ?? { tags: [] };

    try {
      const result = await mod.execute(config, client);

      if (result.success) {
        session.modules[modId].state = "completed";
        results.push(`✅ ${mod.name}: 成功 (リソース: ${result.resources.length}件)`);
      } else {
        results.push(`❌ ${mod.name}: 失敗 (${result.errors.join(", ")})`);
      }

      for (const r of result.resources) {
        if (journal) addResource(journal, r);
        session.modules[modId].resources.push(r);
      }

      if (result.errors.length > 0) {
        session.modules[modId].errors = result.errors;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`❌ ${mod.name}: 例外 (${msg})`);
    }

    saveSession(session);
  }

  return {
    content: [{ type: "text" as const, text: results.join("\n") }],
  };
}
