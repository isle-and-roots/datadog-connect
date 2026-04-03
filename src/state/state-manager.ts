import { readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { writeSecureFile } from "../utils/secure-write.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { STATE_DIR } from "../config/constants.js";
import type { SessionState, DatadogSite } from "../config/types.js";

function getStateDir(): string {
  const dir = join(homedir(), STATE_DIR, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
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

const SAFE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function loadSession(sessionId: string): SessionState | null {
  if (!SAFE_SESSION_ID.test(sessionId)) return null;
  const path = join(getStateDir(), `session-${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionState;
  } catch {
    return null;
  }
}

export function loadLatestSession(): SessionState | null {
  const dir = getStateDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .sort((a, b) => {
      const aTime = statSync(join(dir, a)).mtimeMs;
      const bTime = statSync(join(dir, b)).mtimeMs;
      return bTime - aTime;
    });
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(dir, files[0]), "utf-8")) as SessionState;
  } catch {
    return null;
  }
}
