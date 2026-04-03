import chalk from "chalk";

export function formatRecoveryError(
  context: string,
  error: unknown,
  recovery: string[]
): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lines = [
    chalk.red(`  ✗ ${context}: ${msg}`),
    "",
    chalk.yellow("  復旧方法:"),
    ...recovery.map((r, i) => chalk.dim(`    ${i + 1}. ${r}`)),
  ];
  return lines.join("\n");
}

export function logDebugError(context: string, error: unknown): void {
  // Write to stderr for debugging (not stdout which may be piped)
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(chalk.dim(`  [DEBUG] ${context}: ${msg}`));
}
