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
