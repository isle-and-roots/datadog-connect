import { readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { writeSecureFile } from "../utils/secure-write.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { STATE_DIR } from "../config/constants.js";
import type { SessionState, DatadogSite } from "../config/types.js";

export function getStateDir(): string {
  const dir = join(homedir(), STATE_DIR, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ── Session Summary ───────────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId: string;
  shortId: string;
  createdAt: string;
  site: string;
  preset: string;
  moduleCount: number;
  status: "completed" | "partial" | "pending";
}

/**
 * List sessions sorted by modification time (newest first).
 */
export function listSessions(limit = 10): SessionSummary[] {
  const dir = getStateDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
    .sort((a, b) => {
      const aTime = statSync(join(dir, a)).mtimeMs;
      const bTime = statSync(join(dir, b)).mtimeMs;
      return bTime - aTime;
    })
    .slice(0, limit);

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    try {
      const session = JSON.parse(readFileSync(join(dir, file), "utf-8")) as SessionState;
      const moduleEntries = Object.entries(session.modules);
      const moduleCount = moduleEntries.length;
      const allCompleted = moduleEntries.length > 0 && moduleEntries.every(([, m]) => m.state === "completed");
      const anyCompleted = moduleEntries.some(([, m]) => m.state === "completed");
      const status: SessionSummary["status"] = allCompleted
        ? "completed"
        : anyCompleted
        ? "partial"
        : "pending";

      summaries.push({
        sessionId: session.sessionId,
        shortId: session.sessionId.slice(0, 8),
        createdAt: session.startedAt,
        site: session.site,
        preset: session.profile,
        moduleCount,
        status,
      });
    } catch {
      // skip unreadable session files
    }
  }
  return summaries;
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
