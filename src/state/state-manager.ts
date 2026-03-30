import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { writeSecureFile } from "../utils/secure-write.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { STATE_DIR } from "../config/constants.js";
import type { SessionState, DatadogSite } from "../config/types.js";

function getStateDir(): string {
  const dir = join(homedir(), STATE_DIR, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createSession(site: DatadogSite, profile: string): SessionState {
  const session: SessionState = {
    sessionId: randomUUID(),
    site,
    profile,
    startedAt: new Date().toISOString(),
    modules: {},
  };
  saveSession(session);
  return session;
}

export function saveSession(session: SessionState): void {
  const dir = getStateDir();
  const path = join(dir, `session-${session.sessionId}.json`);
  writeSecureFile(path, JSON.stringify(session, null, 2));
}

export function loadSession(sessionId: string): SessionState | null {
  const path = join(getStateDir(), `session-${sessionId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as SessionState;
}

export function loadLatestSession(): SessionState | null {
  const dir = getStateDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return JSON.parse(readFileSync(join(dir, files[0]), "utf-8")) as SessionState;
}
