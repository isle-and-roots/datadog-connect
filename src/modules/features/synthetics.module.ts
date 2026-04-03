import { select, input, checkbox, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { RESOURCE_PREFIX } from "../../config/constants.js";
import { promptNotification, formatNotificationHandle } from "../shared/notifications.js";
import { printSuccess } from "../../utils/prompts.js";
import { TEST_LOCATIONS, SYNTHETIC_FREQUENCIES as FREQUENCIES, buildSyntheticsApiTestBody } from "../../knowledge/apm-guides.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";

interface ApiTestDef {
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
  maxResponseTime: number;
}

interface SyntheticsConfig extends ModuleConfig {
  apiTests: ApiTestDef[];
  locations: string[];
  frequency: number;
  notificationHandle: string;
}

class SyntheticsModule extends BaseModule {
  readonly id = "synthetics";
  readonly name = "Synthetic監視";
  readonly description = "APIテスト・外形監視を自動作成";
  readonly category = "feature" as const;
  readonly dependencies: string[] = [];

  plan(config: ModuleConfig): ModulePlan {
    const cfg = config as SyntheticsConfig;
    const calls: McpToolCall[] = [];

    for (const test of cfg.apiTests ?? []) {
      const body = buildSyntheticsApiTestBody(
        {
          name: test.name,
          url: test.url,
          method: test.method as "GET" | "POST" | "HEAD",
          expectedStatus: test.expectedStatus,
          maxResponseTime: test.maxResponseTime,
        },
        cfg.locations ?? [],
        cfg.frequency ?? 300,
        cfg.notificationHandle ?? "",
        RESOURCE_PREFIX
      );

      calls.push({
        tool: "datadog_create_synthetics_api_test",
        parameters: { ...body },
        description: `Syntheticテスト「${test.name}」を作成`,
        rollbackCall: {
          tool: "datadog_delete_synthetics_test",
          parameters: { public_id: "{{created_public_id}}" },
          description: `Syntheticテスト「${test.name}」を削除`,
        },
      });
    }

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps: [],
      verificationCalls: [
        {
          tool: "datadog_list_synthetics_tests",
          parameters: { tag_filters: ["managed:datadog-connect"] },
          description: "Syntheticテスト一覧を取得して作成確認",
        },
      ],
    };
  }

  async prompt(): Promise<SyntheticsConfig> {
    const apiTests: ApiTestDef[] = [];
    let first = true;

    while (true) {
      const url = await input({
        message: first
          ? "監視URL (例: https://example.com/api/health):"
          : "追加URL (空でスキップ):",
        default: "",
        validate: (v) => {
          if (!v.trim()) return true; // 空入力はスキップ用
          try {
            const parsed = new URL(v);
            if (parsed.protocol !== "https:") return "セキュリティのため https:// のURLを使用してください";
            return true;
          } catch {
            return "有効なURLを入力してください (https://...)";
          }
        },
      });
      if (!url.trim()) break;
      first = false;

      const method = await select({
        message: `${url} のHTTPメソッド:`,
        choices: [
          { value: "GET", name: "GET" },
          { value: "POST", name: "POST" },
          { value: "HEAD", name: "HEAD" },
        ],
        default: "GET",
      });

      const statusStr = await input({
        message: "期待ステータスコード:",
        default: "200",
      });

      const responseTimeStr = await input({
        message: "最大レスポンスタイム (ms):",
        default: "5000",
      });

      const name = await input({
        message: "テスト名:",
        default: `API Test - ${new URL(url).hostname}`,
      });

      apiTests.push({
        name,
        url,
        method,
        expectedStatus: parseInt(statusStr, 10),
        maxResponseTime: parseInt(responseTimeStr, 10),
      });
    }

    const locations = await checkbox({
      message: "テスト実行ロケーション:",
      choices: TEST_LOCATIONS.map((l) => ({
        ...l,
        checked: l.value === "aws:ap-northeast-1",
      })),
    });

    const frequency = await select({
      message: "チェック頻度:",
      choices: FREQUENCIES.map((f) => ({ value: f.value, name: f.name })),
      default: 300,
    });

    const notification = await promptNotification();
    const notificationHandle = formatNotificationHandle(notification);

    return { apiTests, locations, frequency, notificationHandle };
  }

  async execute(config: SyntheticsConfig, client: unknown): Promise<ExecutionResult> {
    const resources = [];
    const errors = [];

    for (const test of config.apiTests) {
      try {
        const resp = await (client as any).v1.synthetics.createSyntheticsAPITest({
          body: {
            name: `${RESOURCE_PREFIX} ${test.name}`,
            type: "api",
            subtype: "http",
            config: {
              request: {
                method: test.method,
                url: test.url,
              },
              assertions: [
                {
                  type: "statusCode",
                  operator: "is",
                  target: test.expectedStatus,
                },
                {
                  type: "responseTime",
                  operator: "lessThan",
                  target: test.maxResponseTime,
                },
              ],
            },
            options: {
              tickEvery: config.frequency,
              minLocationFailed: 1,
              retry: { count: 1, interval: 300 },
            },
            locations: config.locations,
            message: `${test.name} が失敗しています\n\n${config.notificationHandle}`,
            tags: ["managed:datadog-connect"],
            status: "live",
          },
        });

        resources.push({
          type: "synthetic_test",
          id: resp.publicId ?? "",
          name: `Synthetic: ${test.name}`,
          createdAt: new Date().toISOString(),
        });

        printSuccess(`Syntheticテスト作成: ${test.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`テスト「${test.name}」作成失敗: ${msg}`);
      }
    }

    return { success: errors.length === 0, resources, manualSteps: [], errors };
  }

  async verify(client: unknown): Promise<VerificationResult> {
    const checks = [];
    try {
      const resp = await (client as any).v1.synthetics.listTests();
      const managed = (resp.tests ?? []).filter((t: any) =>
        t.tags?.includes("managed:datadog-connect")
      );
      checks.push({
        name: "Syntheticテスト確認",
        passed: managed.length >= this.createdResources.length,
        detail: `${managed.length}件のテスト`,
      });
    } catch (err) {
      checks.push({
        name: "Syntheticテスト確認",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: checks.every((c) => c.passed), checks };
  }
}

registerModule(new SyntheticsModule());
