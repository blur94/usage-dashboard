import { createHash } from "node:crypto";
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Temporal } from "@js-temporal/polyfill";

/**
 * A single assistant turn that reported token usage, normalized from a
 * Claude Code JSONL session log line. One row per assistant message.
 */
export interface UsageEvent {
  /** Stable per-message id from the log (used as the idempotency key). */
  uuid: string;
  sessionId: string;
  /** Absolute working directory the session ran in (the "project path"). */
  projectPath: string;
  /** Stable short hash of projectPath, used in URLs. */
  projectId: string;
  model: string;
  /** Original ISO-8601 timestamp string. */
  timestamp: string;
  /** Epoch milliseconds, derived via Temporal (indexed for range queries). */
  tsMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** Root directory Claude Code writes session logs to. */
export function getProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/** Deterministic short id for a project path, stable across syncs. */
export function projectIdFor(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
}

/** Last two path segments of a project path, e.g. "Codes/personal". */
export function projectShortName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || projectPath;
}

interface RawLogLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    model?: string;
    role?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

function toEpochMs(timestamp: string): number {
  return Temporal.Instant.from(timestamp).epochMilliseconds;
}

/** Parse one JSONL file into usage events. Malformed lines are skipped. */
export function parseLogFile(filePath: string): UsageEvent[] {
  const events: UsageEvent[] = [];
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return events;
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: RawLogLine;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const usage = raw.message?.usage;
    if (raw.type !== "assistant" || !usage) continue;
    if (!raw.uuid || !raw.sessionId || !raw.timestamp || !raw.cwd) continue;
    // Skip Claude Code's synthetic placeholder turns (no real token cost).
    if (raw.message?.model === "<synthetic>") continue;

    let tsMs: number;
    try {
      tsMs = toEpochMs(raw.timestamp);
    } catch {
      continue;
    }

    events.push({
      uuid: raw.uuid,
      sessionId: raw.sessionId,
      projectPath: raw.cwd,
      projectId: projectIdFor(raw.cwd),
      model: raw.message?.model ?? "unknown",
      timestamp: raw.timestamp,
      tsMs,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    });
  }

  return events;
}

/** Recursively collect every .jsonl file under the projects root. */
export function listLogFiles(root = getProjectsRoot()): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  };

  try {
    statSync(root);
  } catch {
    return files;
  }
  walk(root);
  return files;
}

/** Parse every session log under the projects root into usage events. */
export function parseAllLogs(root = getProjectsRoot()): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const file of listLogFiles(root)) {
    events.push(...parseLogFile(file));
  }
  return events;
}
