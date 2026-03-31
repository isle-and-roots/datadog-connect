import { z } from "zod";

export const credentialsSchema = z.object({
  site: z.enum([
    "datadoghq.com",
    "datadoghq.eu",
    "us3.datadoghq.com",
    "us5.datadoghq.com",
    "ap1.datadoghq.com",
    "ddog-gov.com",
  ]),
  apiKey: z.string().min(1, "API Key は必須です"),
  appKey: z.string().min(1, "Application Key は必須です"),
  profile: z.string().default("default"),
});

export const awsAccountIdSchema = z
  .string()
  .regex(/^\d{12}$/, "AWS Account ID は12桁の数字です");

// MCP tool input schemas
export const SAFE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const mcpSetupArgsSchema = z.object({
  preset: z.enum(["recommended", "aws", "gcp", "security", "xserver", "full", "custom"]),
  modules: z.array(z.string()).optional(),
  module_configs: z.record(z.record(z.unknown())).optional(),
  site: credentialsSchema.shape.site.optional(),
});

export const mcpSessionArgsSchema = z.object({
  session_id: z.string().regex(SAFE_SESSION_ID, "セッションIDはUUID形式です").optional(),
});

export const mcpResumeArgsSchema = mcpSessionArgsSchema.extend({
  module_configs: z.record(z.record(z.unknown())).optional(),
});

export const mcpRollbackArgsSchema = z.object({
  session_id: z.string().regex(SAFE_SESSION_ID, "セッションIDはUUID形式です").optional(),
  confirm: z.literal(true, { message: "confirm: true が必須です" }),
});

export const sessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  site: credentialsSchema.shape.site,
  profile: z.string(),
  startedAt: z.string().datetime(),
  modules: z.record(
    z.object({
      state: z.enum([
        "pending",
        "prompted",
        "executing",
        "completed",
        "failed",
        "skipped",
      ]),
      config: z.record(z.unknown()).optional(),
      resources: z.array(
        z.object({
          type: z.string(),
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
        })
      ),
      errors: z.array(z.string()),
    })
  ),
});
