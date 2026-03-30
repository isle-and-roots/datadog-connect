import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeSecureFile } from "../utils/secure-write.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { STATE_DIR } from "../config/constants.js";
import type { ResourceRecord } from "../config/types.js";

interface Journal {
  sessionId: string;
  resources: ResourceRecord[];
}

function getJournalPath(sessionId: string): string {
  const dir = join(homedir(), STATE_DIR, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `journal-${sessionId}.json`);
}

export function createJournal(sessionId: string): Journal {
  const journal: Journal = { sessionId, resources: [] };
  saveJournal(journal);
  return journal;
}

export function addResource(journal: Journal, resource: ResourceRecord): void {
  journal.resources.push(resource);
  saveJournal(journal);
}

export function saveJournal(journal: Journal): void {
  writeSecureFile(getJournalPath(journal.sessionId), JSON.stringify(journal, null, 2));
}

export function loadJournal(sessionId: string): Journal | null {
  const path = getJournalPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Journal;
  } catch {
    return null;
  }
}
