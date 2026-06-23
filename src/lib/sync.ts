import { insertEvents } from "./db";
import { parseAllLogs } from "./parse-claude-logs";

export interface SyncResult {
  parsed: number;
  inserted: number;
}

/** Parse all Claude Code session logs and upsert into SQLite (idempotent). */
export function runSync(): SyncResult {
  const events = parseAllLogs();
  const inserted = insertEvents(events);
  return { parsed: events.length, inserted };
}
