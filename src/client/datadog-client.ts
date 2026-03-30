import { client as ddClient, v1, v2 } from "@datadog/datadog-api-client";
import type { Credentials } from "../config/types.js";

export interface DatadogClient {
  v1: {
    monitors: v1.MonitorsApi;
    dashboards: v1.DashboardsApi;
    dashboardLists: v1.DashboardListsApi;
    synthetics: v1.SyntheticsApi;
    logsPipelines: v1.LogsPipelinesApi;
    logsIndexes: v1.LogsIndexesApi;
    slos: v1.ServiceLevelObjectivesApi;
    azure: v1.AzureIntegrationApi;
  };
  v2: {
    aws: v2.AWSIntegrationApi;
    awsLogs: v2.AWSLogsIntegrationApi;
    gcp: v2.GCPIntegrationApi;
    serviceDefinition: v2.ServiceDefinitionApi;
    apmRetention: v2.APMRetentionFiltersApi;
    metrics: v2.MetricsApi;
  };
  security: {
    monitoring: v2.SecurityMonitoringApi;
    asm: v2.ApplicationSecurityApi;
    csmThreats: v2.CSMThreatsApi;
    csmCoverage: v2.CSMCoverageAnalysisApi;
    agentlessScanning: v2.AgentlessScanningApi;
    sensitiveData: v2.SensitiveDataScannerApi;
  };
}

export function createDatadogClient(creds: Credentials): DatadogClient {
  const config = ddClient.createConfiguration({
    authMethods: {
      apiKeyAuth: creds.apiKey,
      appKeyAuth: creds.appKey,
    },
    enableRetry: true,
  });
  config.setServerVariables({ site: creds.site });

  return {
    v1: {
      monitors: new v1.MonitorsApi(config),
      dashboards: new v1.DashboardsApi(config),
      dashboardLists: new v1.DashboardListsApi(config),
      synthetics: new v1.SyntheticsApi(config),
      logsPipelines: new v1.LogsPipelinesApi(config),
      logsIndexes: new v1.LogsIndexesApi(config),
      slos: new v1.ServiceLevelObjectivesApi(config),
      azure: new v1.AzureIntegrationApi(config),
    },
    v2: {
      aws: new v2.AWSIntegrationApi(config),
      awsLogs: new v2.AWSLogsIntegrationApi(config),
      gcp: new v2.GCPIntegrationApi(config),
      serviceDefinition: new v2.ServiceDefinitionApi(config),
      apmRetention: new v2.APMRetentionFiltersApi(config),
      metrics: new v2.MetricsApi(config),
    },
    security: {
      monitoring: new v2.SecurityMonitoringApi(config),
      asm: new v2.ApplicationSecurityApi(config),
      csmThreats: new v2.CSMThreatsApi(config),
      csmCoverage: new v2.CSMCoverageAnalysisApi(config),
      agentlessScanning: new v2.AgentlessScanningApi(config),
      sensitiveData: new v2.SensitiveDataScannerApi(config),
    },
  };
}
