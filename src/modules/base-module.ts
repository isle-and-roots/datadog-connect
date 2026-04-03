import type {
  ModuleCategory,
  ModuleConfig,
  ModuleState,
  ResourceRecord,
  ManualStep,
  ExecutionResult,
  VerificationResult,
  PreflightResult,
} from "../config/types.js";
import type { ModulePlan } from "../orchestrator/mcp-call.js";

export abstract class BaseModule {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: ModuleCategory;
  abstract readonly dependencies: string[];

  state: ModuleState = "pending";
  createdResources: ResourceRecord[] = [];
  manualSteps: ManualStep[] = [];

  /**
   * エンタイトルメント事前検証（セキュリティモジュール用）
   * デフォルト実装: 常にavailable（cloud/featureモジュールは不要）
   */
  async preflight(_client: unknown): Promise<PreflightResult> {
    return { available: true };
  }

  /** ユーザーに質問し、設定値を収集する */
  abstract prompt(): Promise<ModuleConfig>;

  /**
   * MCP Harness モード: このモジュールのセットアップに必要な
   * MCP ツール呼び出しプランを生成する。
   * APIを実際に呼び出さず、実行計画のみを返す。
   *
   * デフォルト実装は未実装エラーを投げる。
   * 各モジュールは このメソッドをオーバーライドする。
   */
  plan(_config: ModuleConfig): ModulePlan {
    throw new Error(
      `Module "${this.id}" has not implemented plan() yet. ` +
        `Override this method to support MCP Harness mode.`
    );
  }

  /** Datadog APIを呼び出してリソースを作成する（レガシー） */
  abstract execute(
    config: ModuleConfig,
    client: unknown
  ): Promise<ExecutionResult>;

  /** 作成したリソースが正しく存在するか検証する（レガシー） */
  abstract verify(client: unknown): Promise<VerificationResult>;
}
