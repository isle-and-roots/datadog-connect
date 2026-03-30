import type { DatadogSite } from "../../config/types.js";

/** サイト別の機能対応マップ */
const CAPABILITIES: Record<DatadogSite, Set<string>> = {
  "datadoghq.com": new Set([
    "aws", "gcp", "azure", "apm", "logs", "monitors",
    "dashboards", "synthetics", "cost", "cspm", "cws", "asm", "siem", "sds",
  ]),
  "datadoghq.eu": new Set([
    "aws", "gcp", "azure", "apm", "logs", "monitors",
    "dashboards", "synthetics", "cost", "cspm", "cws", "asm", "siem", "sds",
  ]),
  "us3.datadoghq.com": new Set([
    "aws", "gcp", "azure", "apm", "logs", "monitors",
    "dashboards", "synthetics", "cspm", "asm", "siem", "sds",
  ]),
  "us5.datadoghq.com": new Set([
    "aws", "gcp", "azure", "apm", "logs", "monitors",
    "dashboards", "synthetics", "cspm", "asm", "siem", "sds",
  ]),
  "ap1.datadoghq.com": new Set([
    "aws", "gcp", "azure", "apm", "logs", "monitors",
    "dashboards", "synthetics", "cspm", "asm", "siem", "sds",
  ]),
  "ddog-gov.com": new Set([
    "aws", "apm", "logs", "monitors", "dashboards", "cspm", "cws", "siem",
  ]),
};

export function isCapable(site: DatadogSite, feature: string): boolean {
  return CAPABILITIES[site]?.has(feature) ?? false;
}

export function getCapabilities(site: DatadogSite): string[] {
  return [...(CAPABILITIES[site] ?? [])];
}
