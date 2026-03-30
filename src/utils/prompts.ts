import chalk from "chalk";
import { APP_NAME } from "../config/constants.js";

export function printBanner(): void {
  console.log();
  console.log(chalk.bold.cyan(`  🐕 ${APP_NAME} — かんたんセットアップ`));
  console.log(chalk.dim("  ─".repeat(25)));
  console.log();
}

export function printStep(step: number, title: string): void {
  console.log(chalk.bold.white(`  Step ${step}: ${title}`));
  console.log();
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`  ✅ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`  ❌ ${message}`));
}

export function printManual(message: string): void {
  console.log(chalk.yellow(`  📋 ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.dim(`  ℹ️  ${message}`));
}
