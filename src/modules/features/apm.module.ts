import { checkbox, input, select, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printManual, printSuccess, printInfo } from "../../utils/prompts.js";
import { APM_LANGUAGES, generateInstrumentationGuide, buildServiceCatalogEntry } from "../../knowledge/apm-guides.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";

const LANGUAGES = APM_LANGUAGES;

interface ApmConfig extends ModuleConfig {
  languages: string[];
  services: { name: string; language: string }[];
  environment: string;
  samplingRate: number;
  enableProfiling: boolean;
  enableDataStreams: boolean;
}

class ApmModule extends BaseModule {
  readonly id = "apm";
  readonly name = "APM";
  readonly description = "アプリケーションパフォーマンス監視を設定";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as ApmConfig;
    const calls: McpToolCall[] = [];
    const manualSteps = [];

    // Service catalog registration calls
    for (const svc of cfg.services ?? []) {
      const entry = buildServiceCatalogEntry(svc.name, svc.language, RESOURCE_PREFIX);
      calls.push({
        tool: "datadog_create_service_definition",
        parameters: { ...entry },
        description: `サービスカタログにサービス「${svc.name}」を登録`,
      });
    }

    // APM instrumentation manual steps per language
    for (const lang of cfg.languages ?? []) {
      const guide = generateInstrumentationGuide(lang as Parameters<typeof generateInstrumentationGuide>[0], {
        environment: cfg.environment ?? "production",
        enableProfiling: cfg.enableProfiling ?? false,
        enableDataStreams: cfg.enableDataStreams ?? false,
      });

      manualSteps.push({
        title: `APM計装ガイド (${lang})`,
        description: `${lang}アプリケーションにDatadog APMライブラリを追加してください。\n\n${guide}`,
        commands: [],
      });
    }

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps,
      verificationCalls: [
        {
          tool: "datadog_list_service_definitions",
          parameters: {},
          description: "サービスカタログの登録状況を確認",
        },
      ],
    };
  }

  async prompt(): Promise<ApmConfig> {
    const languages = await checkbox({
      message: "使用プログラミング言語:",
      choices: LANGUAGES.map((l) => ({ ...l, checked: false })),
    });

    if (languages.length === 0) {
      printInfo("言語が選択されていないため、APMサービス登録をスキップします。");
      return { languages: [], services: [], environment: "production", samplingRate: 100, enableProfiling: false, enableDataStreams: false };
    }

    const services: { name: string; language: string }[] = [];
    const addMore = true;
    let first = true;
    while (addMore) {
      const name = await input({
        message: first ? "サービス名 (例: api-gateway):" : "追加サービス名 (空でスキップ):",
        default: "",
      });
      if (!name.trim()) break;
      first = false;

      const language = await select({
        message: `${name} の言語:`,
        choices: languages.map((l) => {
          const lang = LANGUAGES.find((ll) => ll.value === l);
          return { value: l, name: lang?.name ?? l };
        }),
      });
      services.push({ name: name.trim(), language });
    }

    const environment = await select({
      message: "環境名:",
      choices: [
        { value: "production", name: "production" },
        { value: "staging", name: "staging" },
        { value: "development", name: "development" },
      ],
    });

    const samplingRate = 100;

    const enableProfiling = await confirm({
      message: "Continuous Profilerを有効にしますか？",
      default: false,
    });

    const enableDataStreams = await confirm({
      message: "Data Streams Monitoringを有効にしますか？",
      default: false,
    });

    return { languages, services, environment, samplingRate, enableProfiling, enableDataStreams };
  }

  async execute(config: ApmConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    // Register services in Service Catalog
    for (const svc of config.services) {
      try {
        await (client as any).v2.serviceDefinition.createOrUpdateServiceDefinitions({
          body: {
            schemaVersion: "v2.1",
            ddService: svc.name,
            team: "default",
            description: `${RESOURCE_PREFIX} ${svc.name}`,
            tier: "Tier 1",
            languages: [svc.language],
            type: "web",
            lifecycle: "production",
          },
        });

        resources.push({
          type: "service_definition",
          id: svc.name,
          name: `Service: ${svc.name}`,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`サービス登録: ${svc.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`サービス「${svc.name}」登録失敗: ${msg}`);
      }
    }

    // Generate instrumentation guides
    const outputDir = getSecureOutputDir();

    for (const lang of config.languages) {
      const guide = generateInstrumentationGuide(lang as Parameters<typeof generateInstrumentationGuide>[0], {
        environment: config.environment,
        enableProfiling: config.enableProfiling,
        enableDataStreams: config.enableDataStreams,
      });
      const guidePath = `${outputDir}/apm-instrumentation-${lang}.md`;
      writeSecureFile(guidePath, guide);

      manualSteps.push({
        title: `APM計装ガイド (${lang})`,
        description: `${lang}アプリケーションにDatadog APMライブラリを追加してください。`,
        outputFile: guidePath,
      });
    }

    printManual(`計装ガイド: ${outputDir}/apm-instrumentation-*.md`);

    return { success: errors.length === 0, resources, manualSteps, errors };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v2.serviceDefinition.listServiceDefinitions();
      const data = resp.data ?? [];
      const expected = this.createdResources.length;
      checks.push({
        name: "サービスカタログ登録確認",
        passed: data.length >= expected,
        detail: `${data.length}件のサービス定義`,
      });
    } catch (err) {
      checks.push({
        name: "サービスカタログ確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new ApmModule());
