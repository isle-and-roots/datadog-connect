import type { DatadogSite } from "./types.js";

export const DATADOG_SITES: { value: DatadogSite; label: string }[] = [
  { value: "datadoghq.com", label: "US1 (datadoghq.com) — 日本のお客様はUS1またはAP1" },
  { value: "ap1.datadoghq.com", label: "AP1 (ap1.datadoghq.com) — 日本/アジア太平洋リージョン" },
  { value: "datadoghq.eu", label: "EU (datadoghq.eu)" },
  { value: "us3.datadoghq.com", label: "US3 (us3.datadoghq.com)" },
  { value: "us5.datadoghq.com", label: "US5 (us5.datadoghq.com)" },
  { value: "ddog-gov.com", label: "GOV (ddog-gov.com) — 米国政府向け" },
];

export const SITE_API_BASE: Record<DatadogSite, string> = {
  "datadoghq.com": "https://api.datadoghq.com",
  "datadoghq.eu": "https://api.datadoghq.eu",
  "us3.datadoghq.com": "https://api.us3.datadoghq.com",
  "us5.datadoghq.com": "https://api.us5.datadoghq.com",
  "ap1.datadoghq.com": "https://api.ap1.datadoghq.com",
  "ddog-gov.com": "https://api.ddog-gov.com",
};

export const RESOURCE_PREFIX = "[DDConnect]";

/** Datadog console URL paths per module, relative to https://app.datadoghq.com */
export const MODULE_CONSOLE_URLS: Record<string, string> = {
  monitors: "/monitors/manage",
  dashboards: "/dashboard/lists",
  apm: "/apm/services",
  logs: "/logs/pipelines",
  synthetics: "/synthetics/tests",
  aws: "/integrations/amazon-web-services",
  gcp: "/integrations/google-cloud-platform",
  azure: "/integrations/azure",
  "on-prem": "/infrastructure/list",
  kubernetes: "/infrastructure/kubernetes",
  xserver: "/infrastructure/list",
  cspm: "/security/cspm",
  cws: "/security/cws",
  asm: "/security/appsec",
  siem: "/security/detection-rules",
  "sensitive-data": "/security/sensitive-data-scanner",
};

export const STATE_DIR = ".datadog-connect";

export const APP_NAME = "Datadog Connect";
declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";
