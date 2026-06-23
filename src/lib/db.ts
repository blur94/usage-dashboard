import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { UsageEvent } from "./parse-claude-logs";

/** On-disk location of the local usage database (gitignored). */
export const DB_PATH = join(process.cwd(), "data", "usage-dashboard.db");

let db: Database.Database | null = null;

/** Lazily open the SQLite database, creating schema on first use. */
export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      uuid TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      project_id TEXT NOT NULL,
      model TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      ts_ms INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_creation_input_tokens INTEGER NOT NULL,
      cache_read_input_tokens INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts_ms);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events (project_id, ts_ms);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, ts_ms);
    CREATE INDEX IF NOT EXISTS idx_events_model ON events (model);
  `);
}

/**
 * Insert parsed events idempotently. Re-running with the same events inserts
 * no duplicates (the message uuid is the primary key). Returns the number of
 * newly inserted rows.
 */
export function insertEvents(events: UsageEvent[]): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO events (
      uuid, session_id, project_path, project_id, model, timestamp, ts_ms,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
    ) VALUES (
      @uuid, @sessionId, @projectPath, @projectId, @model, @timestamp, @tsMs,
      @inputTokens, @outputTokens, @cacheCreationInputTokens, @cacheReadInputTokens
    )
  `);

  const insertMany = database.transaction((rows: UsageEvent[]) => {
    let inserted = 0;
    for (const row of rows) {
      const info = stmt.run(row);
      inserted += info.changes;
    }
    return inserted;
  });

  return insertMany(events);
}
