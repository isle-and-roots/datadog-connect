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

export const STATE_DIR = ".datadog-connect";

export const APP_NAME = "Datadog Connect";
export const APP_VERSION = "0.1.0";
