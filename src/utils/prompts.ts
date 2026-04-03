import chalk from "chalk";
import { APP_NAME } from "../config/constants.js";

// ── ASCII mode & terminal width ───────────────────────────────────────────────

const useAscii = process.env.DD_ASCII === "1";
const termWidth = process.stdout.columns || 80;

/**
 * Return emoji or ASCII fallback depending on DD_ASCII env var.
 */
function icon(emoji: string, ascii: string): string {
  return useAscii ? ascii : emoji;
}

// ── Print functions ───────────────────────────────────────────────────────────

export function printBanner(): void {
  const sep = chalk.dim("  " + "─".repeat(Math.min(termWidth - 4, 50)));
  console.log();
  console.log(chalk.bold.cyan(`  ${icon("🐕", "[DD]")} ${APP_NAME} — かんたんセットアップ`));
  console.log(sep);
  console.log();
}

export function printStep(step: number, title: string): void {
  console.log(chalk.bold.white(`  Step ${step}: ${title}`));
  console.log();
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`  ${icon("✅", "[OK]")} ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`  ${icon("❌", "[ER]")} ERROR: ${message}`));
}

export function printManual(message: string): void {
  console.log(chalk.yellow(`  ${icon("📋", "[>>]")} MANUAL: ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.dim(`  ${icon("ℹ️", "[--]")}  INFO: ${message}`));
}
