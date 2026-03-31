import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { STATE_DIR } from "../config/constants.js";

/** ファイルを 0o600 (owner read/write only) で書き出す */
export function writeSecureFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
}

/** スクリプトを 0o700 (owner execute) で書き出す */
export function writeExecutableFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o700 });
}

/** 安全な出力ディレクトリ (~/.datadog-connect/output/) */
export function getSecureOutputDir(): string {
  const dir = join(homedir(), STATE_DIR, "output");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
