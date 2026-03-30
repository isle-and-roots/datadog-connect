import { input } from "@inquirer/prompts";

export async function promptTags(): Promise<string[]> {
  const raw = await input({
    message: "タグ (カンマ区切り, 例: env:production,team:infra):",
    default: "",
  });
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
