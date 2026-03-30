import { input, select } from "@inquirer/prompts";

export interface NotificationTarget {
  type: "slack" | "email" | "pagerduty" | "opsgenie";
  handle: string;
}

export async function promptNotification(): Promise<NotificationTarget> {
  const type = await select({
    message: "通知先の種類:",
    choices: [
      { value: "slack" as const, name: "Slack" },
      { value: "email" as const, name: "Email" },
      { value: "pagerduty" as const, name: "PagerDuty" },
      { value: "opsgenie" as const, name: "OpsGenie" },
    ],
  });

  const placeholders: Record<string, string> = {
    slack: "@slack-channel-name",
    email: "user@example.com",
    pagerduty: "@pagerduty-service",
    opsgenie: "@opsgenie-service",
  };

  const handle = await input({
    message: `通知先 (${type}):`,
    default: placeholders[type],
  });

  return { type, handle };
}

export function formatNotificationHandle(target: NotificationTarget): string {
  switch (target.type) {
    case "slack":
      return target.handle.startsWith("@") ? target.handle : `@${target.handle}`;
    case "email":
      return target.handle;
    case "pagerduty":
      return target.handle.startsWith("@") ? target.handle : `@${target.handle}`;
    case "opsgenie":
      return target.handle.startsWith("@") ? target.handle : `@${target.handle}`;
  }
}
