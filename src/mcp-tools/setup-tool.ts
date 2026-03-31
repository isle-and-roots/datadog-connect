import { createDatadogClient } from "../client/datadog-client.js";
import { createSession, saveSession } from "../state/state-manager.js";
import { createJournal, addResource } from "../state/operation-journal.js";
import { getModules, resolveOrder } from "../modules/registry.js";
import { mcpSetupArgsSchema } from "../config/schema.js";
import type { ResourceRecord, ManualStep, DatadogSite } from "../config/types.js";

// Register all 16 modules
import "../modules/all.js";

const PRESETS: Record<string, string[]> = {
  recommended: ["dashboards", "monitors", "logs"],
  aws: ["aws", "dashboards", "monitors", "apm", "logs"],
  gcp: ["gcp", "dashboards", "monitors", "apm", "logs"],
  security: ["apm", "logs", "cspm", "cws", "asm", "siem", "sensitive-data"],
  xserver: ["xserver", "dashboards", "monitors"],
  full: [
    "aws", "gcp", "azure", "on-prem", "kubernetes", "xserver",
    "apm", "logs", "dashboards", "monitors", "synthetics",
    "cspm", "cws", "asm", "siem", "sensitive-data",
  ],
};

export const SETUP_TOOL_DEF = {
  name: "datadog_setup",
  description:
    "Datadog のセットアップを実行します。プリセット（recommended/aws/gcp/security/xserver/full）または個別モジュール指定が可能。各モジュールの設定はmodule_configsで渡します。認証はDD_API_KEY/DD_APP_KEY環境変数を使用。",
  inputSchema: {
    type: "object" as const,
    properties: {
      preset: {
        type: "string",
        enum: ["recommended", "aws", "gcp", "security", "xserver", "full", "custom"],
        description: "セットアップタイプ。custom の場合は modules を指定",
      },
      modules: {
        type: "array",
        items: { type: "string" },
        description: "preset=custom 時に実行するモジュールIDのリスト",
      },
      module_configs: {
        type: "object",
        description:
          "各モジュールの設定。キーはモジュールID、値は設定オブジェクト。例: { aws: { accountId: '123456789012', regions: ['ap-northeast-1'] } }",
        additionalProperties: true,
      },
      site: {
        type: "string",
        enum: ["datadoghq.com", "datadoghq.eu", "us3.datadoghq.com", "us5.datadoghq.com", "ap1.datadoghq.com", "ddog-gov.com"],
        description: "Datadog サイト（デフォルト: datadoghq.com）",
      },
    },
    required: ["preset"],
  },
};

export async function setupTool(args: Record<string, unknown>) {
  // Input validation
  const parsed = mcpSetupArgsSchema.safeParse(args);
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
      content: [
        {
          type: "text" as const,
          text: "エラー: DD_API_KEY と DD_APP_KEY 環境変数が設定されていません。MCP サーバー登録時に -e DD_API_KEY=xxx -e DD_APP_KEY=yyy で渡してください。",
        },
      ],
      isError: true,
    };
  }

  const validated = parsed.data;
  const site = validated.site ?? (process.env.DD_SITE as DatadogSite) ?? "datadoghq.com";
  const preset = validated.preset;
  const moduleConfigs = validated.module_configs ?? {};

  const client = createDatadogClient({ site, apiKey, appKey, profile: "mcp" });
  const session = createSession(site, "mcp");
  const journal = createJournal(session.sessionId);

  // Resolve modules
  const allModules = getModules();
  let moduleIds: string[];

  if (preset === "custom") {
    moduleIds = validated.modules ?? [];
  } else {
    const presetModules = PRESETS[preset];
    if (!presetModules) {
      return {
        content: [{ type: "text" as const, text: `エラー: 不明なプリセット "${preset}"` }],
        isError: true,
      };
    }
    moduleIds = presetModules;
  }

  const idSet = new Set(moduleIds);
  const selectedModules = allModules.filter((m) => idSet.has(m.id));

  if (selectedModules.length === 0) {
    return {
      content: [{ type: "text" as const, text: "エラー: 有効なモジュールが選択されていません。" }],
      isError: true,
    };
  }

  const ordered = resolveOrder(selectedModules);

  const allResources: ResourceRecord[] = [];
  const allManualSteps: ManualStep[] = [];
  const allErrors: string[] = [];
  const moduleResults: Record<string, { status: string; resources: number; errors: string[] }> = {};

  for (const mod of ordered) {
    session.modules[mod.id] = { state: "pending", resources: [], errors: [] };

    // Preflight for security modules
    if (mod.category === "security") {
      const preflight = await mod.preflight(client);
      if (!preflight.available) {
        mod.state = "skipped";
        session.modules[mod.id].state = "skipped";
        moduleResults[mod.id] = { status: "skipped", resources: 0, errors: [preflight.reason ?? "利用不可"] };
        saveSession(session);
        continue;
      }
    }

    // Use provided config or generate defaults
    const config = moduleConfigs[mod.id] ?? getDefaultConfig(mod.id);

    // Execute
    mod.state = "executing";
    session.modules[mod.id].state = "executing";

    try {
      const result = await mod.execute(config, client);

      if (result.success) {
        mod.state = "completed";
        session.modules[mod.id].state = "completed";
      } else {
        mod.state = "failed";
        session.modules[mod.id].state = "failed";
      }

      for (const r of result.resources) {
        addResource(journal, r);
        mod.createdResources.push(r);
        allResources.push(r);
        session.modules[mod.id].resources.push(r);
      }

      mod.manualSteps = result.manualSteps;
      allManualSteps.push(...result.manualSteps);

      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map((e) => `[${mod.name}] ${e}`));
        session.modules[mod.id].errors = result.errors;
      }

      moduleResults[mod.id] = {
        status: result.success ? "completed" : "failed",
        resources: result.resources.length,
        errors: result.errors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mod.state = "failed";
      session.modules[mod.id].state = "failed";
      session.modules[mod.id].errors.push(msg);
      allErrors.push(`[${mod.name}] ${msg}`);
      moduleResults[mod.id] = { status: "failed", resources: 0, errors: [msg] };
    }

    saveSession(session);

    // Verify
    if (mod.state === "completed") {
      try {
        const verification = await mod.verify(client);
        if (!verification.success) {
          const failed = verification.checks.filter((c) => !c.passed);
          for (const c of failed) {
            allErrors.push(`[${mod.name}] 検証NG: ${c.name} — ${c.detail ?? ""}`);
          }
        }
      } catch {
        // Verification failure is non-fatal
      }
    }
  }

  // Build result summary
  const summary = [
    `セッション: ${session.sessionId}`,
    `プリセット: ${preset}`,
    ``,
    `--- 結果 ---`,
    `作成リソース: ${allResources.length}件`,
    `手動手順: ${allManualSteps.length}件`,
    `エラー: ${allErrors.length}件`,
    ``,
    `--- モジュール別 ---`,
    ...Object.entries(moduleResults).map(
      ([id, r]) => `  ${id}: ${r.status} (リソース: ${r.resources}件${r.errors.length > 0 ? `, エラー: ${r.errors.join(", ")}` : ""})`
    ),
  ];

  if (allManualSteps.length > 0) {
    summary.push(``, `--- 手動手順 ---`);
    for (const step of allManualSteps) {
      summary.push(`  📋 ${step.title}`);
      if (step.outputFile) summary.push(`     → ${step.outputFile}`);
    }
  }

  if (allErrors.length > 0) {
    summary.push(``, `--- エラー詳細 ---`);
    for (const e of allErrors) summary.push(`  ❌ ${e}`);
    summary.push(``, `失敗したモジュールは datadog_resume ツールで再実行できます。`);
  }

  return {
    content: [{ type: "text" as const, text: summary.join("\n") }],
  };
}

function getDefaultConfig(moduleId: string): Record<string, unknown> {
  // Minimal defaults for modules that can run without user input
  switch (moduleId) {
    case "dashboards":
      return { presets: ["infra-overview"], tags: [] };
    case "monitors":
      return { packs: ["INFRA_PACK"], useDefaults: true, notificationHandle: "", tags: [] };
    case "logs":
      return { sources: ["nginx"], tags: [] };
    case "apm":
      return { services: [], languages: [], tags: [] };
    case "synthetics":
      return { endpoints: [], tags: [] };
    case "cspm":
      return { clouds: [], tags: [] };
    case "cws":
      return { tags: [] };
    case "asm":
      return { enableWaf: true, tags: [] };
    case "siem":
      return { packs: ["AUTH_PACK"], tags: [] };
    case "sensitive-data":
      return { patterns: ["PII"], tags: [] };
    default:
      return { tags: [] };
  }
}
