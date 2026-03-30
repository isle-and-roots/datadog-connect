import { checkbox, input, select, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { printManual, printSuccess } from "../../utils/prompts.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";
import { writeSecureFile, getSecureOutputDir } from "../../utils/secure-write.js";

const LANGUAGES = [
  { value: "java", name: "Java" },
  { value: "python", name: "Python" },
  { value: "nodejs", name: "Node.js" },
  { value: "go", name: "Go" },
  { value: "ruby", name: "Ruby" },
  { value: "dotnet", name: ".NET" },
  { value: "php", name: "PHP" },
];

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

  async prompt(): Promise<ApmConfig> {
    const languages = await checkbox({
      message: "使用プログラミング言語:",
      choices: LANGUAGES.map((l) => ({ ...l, checked: false })),
    });

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

  async execute(config: ApmConfig, client: DatadogClient): Promise<ExecutionResult> {
    const resources = [];
    const manualSteps = [];
    const errors = [];

    // Register services in Service Catalog
    for (const svc of config.services) {
      try {
        await client.v2.serviceDefinition.createOrUpdateServiceDefinitions({
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
      const guide = generateInstrumentationGuide(lang, config);
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

  async verify(client: DatadogClient): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await client.v2.serviceDefinition.listServiceDefinitions();
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

function generateInstrumentationGuide(lang: string, config: ApmConfig): string {
  const guides: Record<string, string> = {
    nodejs: `# Node.js APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
npm install dd-trace
\`\`\`

## 2. アプリケーション起動時に初期化
\`\`\`javascript
// app.js の先頭に追加
require('dd-trace').init({
  service: '<SERVICE_NAME>',
  env: '${config.environment}',
  version: '1.0.0',
  ${config.enableProfiling ? "profiling: true," : ""}
  runtimeMetrics: true,
});
\`\`\`

## 3. 環境変数
\`\`\`bash
DD_AGENT_HOST=localhost
DD_TRACE_AGENT_PORT=8126
DD_ENV=${config.environment}
\`\`\`
`,
    python: `# Python APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
pip install ddtrace
\`\`\`

## 2. アプリケーション起動
\`\`\`bash
ddtrace-run python app.py
# または
DD_SERVICE=<SERVICE_NAME> DD_ENV=${config.environment} ddtrace-run gunicorn app:app
\`\`\`

## 3. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${config.environment}
${config.enableProfiling ? "DD_PROFILING_ENABLED=true" : ""}
\`\`\`
`,
    java: `# Java APM 計装ガイド
## 1. Agent ダウンロード
\`\`\`bash
curl -Lo dd-java-agent.jar https://dtdg.co/latest-java-tracer
\`\`\`

## 2. JVMオプション追加
\`\`\`bash
java -javaagent:dd-java-agent.jar \\
  -Ddd.service=<SERVICE_NAME> \\
  -Ddd.env=${config.environment} \\
  ${config.enableProfiling ? "-Ddd.profiling.enabled=true \\\n  " : ""}-jar app.jar
\`\`\`
`,
    go: `# Go APM 計装ガイド
## 1. ライブラリインストール
\`\`\`bash
go get gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer
\`\`\`

## 2. コードに追加
\`\`\`go
import "gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"

func main() {
    tracer.Start(
        tracer.WithService("<SERVICE_NAME>"),
        tracer.WithEnv("${config.environment}"),
    )
    defer tracer.Stop()
}
\`\`\`
`,
    ruby: `# Ruby APM 計装ガイド
## 1. Gemfileに追加
\`\`\`ruby
gem 'datadog', require: 'datadog/auto_instrument'
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${config.environment}
\`\`\`
`,
    dotnet: `# .NET APM 計装ガイド
## 1. NuGetパッケージ追加
\`\`\`bash
dotnet add package Datadog.Trace.Bundle
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${config.environment}
CORECLR_ENABLE_PROFILING=1
CORECLR_PROFILER={846F5F1C-F9AE-4B07-969E-05C26BC060D8}
\`\`\`
`,
    php: `# PHP APM 計装ガイド
## 1. 拡張インストール
\`\`\`bash
# pecl
pecl install datadog_trace
echo "extension=ddtrace.so" >> php.ini
\`\`\`

## 2. 環境変数
\`\`\`bash
DD_SERVICE=<SERVICE_NAME>
DD_ENV=${config.environment}
\`\`\`
`,
  };

  return guides[lang] ?? `# ${lang} APM 計装ガイド\nSee: https://docs.datadoghq.com/tracing/trace_collection/\n`;
}

registerModule(new ApmModule());
