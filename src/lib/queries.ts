import { Temporal } from "@js-temporal/polyfill";
import type DatabaseType from "better-sqlite3";
import { getDb } from "./db";
import { projectShortName } from "./parse-claude-logs";
import { costExpressionSql } from "./pricing";
import type { TokenBreakdown } from "./pricing";
import { aggregateInsights, type ScopeCostInsight } from "./cost-insights";

const COST = costExpressionSql();

/** Local timezone used for all calendar-based boundaries and bucketing. */
function timeZone(): string {
  return Temporal.Now.timeZoneId();
}

function nowZoned() {
  return Temporal.Now.zonedDateTimeISO();
}

/** Epoch-ms boundary N days ago from the start of today (local). */
export function daysAgoMs(days: number): number {
  const startOfToday = nowZoned().startOfDay();
  return startOfToday.subtract({ days: days - 1 }).epochMilliseconds;
}

/** Epoch-ms boundary at the start of the current calendar month (local). */
function startOfMonthMs(): number {
  const now = nowZoned();
  return now.with({ day: 1 }).startOfDay().epochMilliseconds;
}

/** Epoch-ms boundary at the start of the current week (Monday, local). */
function startOfWeekMs(): number {
  const now = nowZoned();
  const back = (now.dayOfWeek + 6) % 7; // Monday = 0
  return now.subtract({ days: back }).startOfDay().epochMilliseconds;
}

export interface OverviewKpis {
  totalTokensThisMonth: number;
  estimatedCostThisMonth: number;
  cacheHitRate: number;
  mostUsedModelThisWeek: string | null;
  activeProjectCount: number;
}

export function getOverviewKpis(): OverviewKpis {
  const db = getDb();

  const month = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total,
              COALESCE(SUM(${COST}), 0) AS cost
       FROM events WHERE ts_ms >= ?`,
    )
    .get(startOfMonthMs()) as { total: number; cost: number };

  const cache = db
    .prepare(
      `SELECT COALESCE(SUM(cache_read_input_tokens), 0) AS reads,
              COALESCE(SUM(input_tokens), 0) AS inputs
       FROM events WHERE ts_ms >= ?`,
    )
    .get(startOfMonthMs()) as { reads: number; inputs: number };

  const denom = cache.reads + cache.inputs;
  const cacheHitRate = denom === 0 ? 0 : cache.reads / denom;

  const model = db
    .prepare(
      `SELECT model, SUM(input_tokens + output_tokens) AS total
       FROM events WHERE ts_ms >= ?
       GROUP BY model ORDER BY total DESC LIMIT 1`,
    )
    .get(startOfWeekMs()) as { model: string; total: number } | undefined;

  const active = db
    .prepare(
      `SELECT COUNT(DISTINCT project_id) AS c
       FROM events WHERE ts_ms >= ?`,
    )
    .get(daysAgoMs(7)) as { c: number };

  return {
    totalTokensThisMonth: month.total,
    estimatedCostThisMonth: month.cost,
    cacheHitRate,
    mostUsedModelThisWeek: model?.model ?? null,
    activeProjectCount: active.c,
  };
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (local)
  input: number;
  output: number;
}

/**
 * Daily input vs output tokens over the given window, gap-filled so every day
 * in range has a point. Optionally filtered to a single model.
 */
export function getDailyTokens(days: number, model?: string): DailyPoint[] {
  const db = getDb();
  const start = daysAgoMs(days);
  const offsetSeconds = nowZoned().offset; // e.g. "+01:00"

  const rows = db
    .prepare(
      `SELECT date((ts_ms / 1000) + ?, 'unixepoch') AS date,
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output
       FROM events
       WHERE ts_ms >= ? ${model ? "AND model = ?" : ""}
       GROUP BY date ORDER BY date`,
    )
    .all(
      ...(model
        ? [offsetSecondsToSeconds(offsetSeconds), start, model]
        : [offsetSecondsToSeconds(offsetSeconds), start]),
    ) as DailyPoint[];

  return gapFill(rows, days);
}

/** Convert an ISO offset string like "+01:00" to seconds for SQL date math. */
function offsetSecondsToSeconds(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h, m] = offset.replace(/[+-]/, "").split(":").map(Number);
  return sign * (h * 3600 + m * 60);
}

function gapFill(rows: DailyPoint[], days: number): DailyPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DailyPoint[] = [];
  let cursor = nowZoned().startOfDay().subtract({ days: days - 1 });
  for (let i = 0; i < days; i++) {
    const key = `${cursor.year.toString().padStart(4, "0")}-${cursor.month
      .toString()
      .padStart(2, "0")}-${cursor.day.toString().padStart(2, "0")}`;
    out.push(byDate.get(key) ?? { date: key, input: 0, output: 0 });
    cursor = cursor.add({ days: 1 });
  }
  return out;
}

export interface ProjectRow {
  projectId: string;
  projectPath: string;
  shortName: string;
  sessions: number;
  totalTokens: number;
  estimatedCost: number;
  cacheHitRate: number;
  lastActiveMs: number;
}

export function getProjects(): ProjectRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_id AS projectId,
              project_path AS projectPath,
              COUNT(DISTINCT session_id) AS sessions,
              SUM(input_tokens + output_tokens) AS totalTokens,
              SUM(${COST}) AS estimatedCost,
              SUM(cache_read_input_tokens) AS reads,
              SUM(input_tokens) AS inputs,
              MAX(ts_ms) AS lastActiveMs
       FROM events
       GROUP BY project_id
       ORDER BY totalTokens DESC`,
    )
    .all() as Array<
    Omit<ProjectRow, "shortName" | "cacheHitRate"> & {
      reads: number;
      inputs: number;
    }
  >;

  return rows.map((r) => ({
    projectId: r.projectId,
    projectPath: r.projectPath,
    shortName: projectShortName(r.projectPath),
    sessions: r.sessions,
    totalTokens: r.totalTokens,
    estimatedCost: r.estimatedCost,
    cacheHitRate: r.reads + r.inputs === 0 ? 0 : r.reads / (r.reads + r.inputs),
    lastActiveMs: r.lastActiveMs,
  }));
}

export function getProjectMeta(projectId: string): { shortName: string } | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT project_path AS p FROM events WHERE project_id = ? LIMIT 1`)
    .get(projectId) as { p: string } | undefined;
  return row ? { shortName: projectShortName(row.p) } : null;
}

export interface SessionRow {
  sessionId: string;
  lastActiveMs: number;
  turns: number;
  totalTokens: number;
  estimatedCost: number;
  cacheHitRate: number;
}

export function getSessions(projectId: string): SessionRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
              MAX(ts_ms) AS lastActiveMs,
              COUNT(*) AS turns,
              SUM(input_tokens + output_tokens) AS totalTokens,
              SUM(${COST}) AS estimatedCost,
              SUM(cache_read_input_tokens) AS reads,
              SUM(input_tokens) AS inputs
       FROM events
       WHERE project_id = ?
       GROUP BY session_id
       ORDER BY lastActiveMs DESC`,
    )
    .all(projectId) as Array<
    Omit<SessionRow, "cacheHitRate"> & { reads: number; inputs: number }
  >;

  return rows.map((r) => ({
    sessionId: r.sessionId,
    lastActiveMs: r.lastActiveMs,
    turns: r.turns,
    totalTokens: r.totalTokens,
    estimatedCost: r.estimatedCost,
    cacheHitRate: r.reads + r.inputs === 0 ? 0 : r.reads / (r.reads + r.inputs),
  }));
}

export interface ModelRow {
  model: string;
  totalTokens: number;
  estimatedCost: number;
}

export function getModelTotals(): ModelRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT model,
              SUM(input_tokens + output_tokens) AS totalTokens,
              SUM(${COST}) AS estimatedCost
       FROM events
       GROUP BY model
       ORDER BY totalTokens DESC`,
    )
    .all() as ModelRow[];
}

interface ModelTokenRow {
  model: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

function toEntry(r: ModelTokenRow): { tokens: TokenBreakdown; model: string } {
  return {
    model: r.model,
    tokens: {
      input: r.input,
      output: r.output,
      cacheCreation: r.cacheCreation,
      cacheRead: r.cacheRead,
    },
  };
}

/** Aggregate cost insight over events since `sinceMs` (default: all time). */
export function getCostInsight(
  sinceMs?: number,
  database: DatabaseType.Database = getDb(),
): ScopeCostInsight {
  const rows = database
    .prepare(
      `SELECT model,
              COALESCE(SUM(input_tokens), 0) AS input,
              COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(cache_creation_input_tokens), 0) AS cacheCreation,
              COALESCE(SUM(cache_read_input_tokens), 0) AS cacheRead
       FROM events
       ${sinceMs != null ? "WHERE ts_ms >= ?" : ""}
       GROUP BY model`,
    )
    .all(...(sinceMs != null ? [sinceMs] : [])) as ModelTokenRow[];
  return aggregateInsights(rows.map(toEntry));
}

/** Cost insight scoped to the current calendar month. */
export function getCostInsightThisMonth(
  database: DatabaseType.Database = getDb(),
): ScopeCostInsight {
  return getCostInsight(startOfMonthMs(), database);
}

export interface ProjectInsightRow {
  projectId: string;
  shortName: string;
  actualCost: number;
  potentialSavings: number;
  cacheSavings: number;
  recommendation: string | null;
}

/** Per-project cost insight, sorted by potential savings (largest first). */
export function getProjectInsights(
  database: DatabaseType.Database = getDb(),
): ProjectInsightRow[] {
  const rows = database
    .prepare(
      `SELECT project_id AS projectId, project_path AS projectPath, model,
              COALESCE(SUM(input_tokens), 0) AS input,
              COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(cache_creation_input_tokens), 0) AS cacheCreation,
              COALESCE(SUM(cache_read_input_tokens), 0) AS cacheRead
       FROM events
       GROUP BY project_id, model`,
    )
    .all() as Array<ModelTokenRow & { projectId: string; projectPath: string }>;

  const grouped = new Map<
    string,
    {
      projectPath: string;
      entries: { tokens: TokenBreakdown; model: string }[];
    }
  >();
  for (const r of rows) {
    const g =
      grouped.get(r.projectId) ?? { projectPath: r.projectPath, entries: [] };
    g.entries.push(toEntry(r));
    grouped.set(r.projectId, g);
  }

  const out: ProjectInsightRow[] = [];
  for (const [projectId, g] of grouped) {
    const agg = aggregateInsights(g.entries);
    out.push({
      projectId,
      shortName: projectShortName(g.projectPath),
      actualCost: agg.actualCost,
      potentialSavings: agg.potentialSavings,
      cacheSavings: agg.cacheSavings,
      recommendation: agg.recommendation,
    });
  }
  out.sort((a, b) => b.potentialSavings - a.potentialSavings);
  return out;
}

export { timeZone };
