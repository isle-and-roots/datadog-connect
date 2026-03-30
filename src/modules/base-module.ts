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
import type { DatadogClient } from "../client/datadog-client.js";

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
   * API probeで権限確認。未対応プランならavailable:falseを返す。
   * デフォルト実装: 常にavailable（cloud/featureモジュールは不要）
   */
  async preflight(_client: DatadogClient): Promise<PreflightResult> {
    return { available: true };
  }

  /** ユーザーに質問し、設定値を収集する */
  abstract prompt(): Promise<ModuleConfig>;

  /** Datadog APIを呼び出してリソースを作成する */
  abstract execute(
    config: ModuleConfig,
    client: DatadogClient
  ): Promise<ExecutionResult>;

  /** 作成したリソースが正しく存在するか検証する */
  abstract verify(client: DatadogClient): Promise<VerificationResult>;
}
