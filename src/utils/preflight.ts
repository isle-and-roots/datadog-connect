import chalk from "chalk";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

/**
 * Run pre-flight checks before setup or MCP registration.
 *
 * Checks are non-destructive (read-only environment inspection).
 * Only checks for which data is available are included in the result.
 */
export function runPreflight(): PreflightResult {
  const checks: PreflightCheck[] = [];

  // Check 1: DD_API_KEY format (if set)
  const apiKey = process.env.DD_API_KEY;
  if (apiKey) {
    const valid = /^[0-9a-f]{32}$/i.test(apiKey);
    checks.push({
      name: "DD_API_KEY",
      passed: valid,
      message: valid
        ? "フォーマットOK (32文字16進数)"
        : `フォーマット不正: ${apiKey.length}文字 (32文字の16進数が必要)`,
    });
  }

  // Check 2: DD_APP_KEY format (if set)
  const appKey = process.env.DD_APP_KEY;
  if (appKey) {
    const valid = /^[0-9a-f]{40}$/i.test(appKey);
    checks.push({
      name: "DD_APP_KEY",
      passed: valid,
      message: valid
        ? "フォーマットOK (40文字16進数)"
        : `フォーマット不正: ${appKey.length}文字 (40文字の16進数が必要)`,
    });
  }

  // Check 3: Node version
  const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
  checks.push({
    name: "Node.js",
    passed: nodeVersion >= 20,
    message:
      nodeVersion >= 20
        ? `v${process.versions.node}`
        : `v${process.versions.node} (v20以上が必要)`,
  });

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

/**
 * Print the preflight result to stdout with colored output.
 */
export function printPreflightResult(result: PreflightResult): void {
  console.log(chalk.bold("\n  事前チェック"));
  console.log(chalk.dim("  ─────────────"));
  for (const check of result.checks) {
    const icon = check.passed ? chalk.green("✓") : chalk.red("✗");
    const msg = check.passed
      ? chalk.dim(check.message)
      : chalk.red(check.message);
    console.log(`  ${icon} ${check.name}: ${msg}`);
  }
  console.log();
}

/**
 * Returns true if any preflight check that relates to API key format failed.
 * Node.js version failure is a warning but should not block interactive setup.
 */
export function hasApiKeyFormatError(result: PreflightResult): boolean {
  return result.checks.some(
    (c) =>
      !c.passed && (c.name === "DD_API_KEY" || c.name === "DD_APP_KEY")
  );
}
