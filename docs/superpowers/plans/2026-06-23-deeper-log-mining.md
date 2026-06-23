# Deeper Log Mining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mine the data the parser currently discards — tool calls and session shape — to add tool-usage analytics, session duration, and average tokens-per-turn, without disturbing existing token/cost data.

**Architecture:** Extract a pure `parseLogContents(contents)` from the file reader and have it additionally emit `ToolCallEvent`s from each assistant message's `content[]` (`type: "tool_use"` → `name`). Tool calls land in a new idempotent `tool_calls` table; sync inserts both events and tool calls. New queries aggregate tool usage; `getSessions` is extended to derive duration and avg tokens/turn from existing timestamps. UI gains a Tools page and two session columns.

**Tech Stack:** Next.js 16 · React 19 · TypeScript (strict) · better-sqlite3 · Recharts · `@js-temporal/polyfill` · Vitest.

## Global Constraints

- **Depends on Phase 1 (Cost Intelligence)** for Vitest, `openMemoryDb()`, and `insertEvents(events, db?)`. Do not start until those exist.
- Next.js 16 — consult `node_modules/next/dist/docs/` before writing Next-specific code.
- **Verified log facts (from real `~/.claude/projects` logs):** tool calls appear as `message.content[]` entries with `type === "tool_use"` and a `name`. There is **no per-turn latency/duration field** in the logs (only `timestamp`). Therefore PRD story 19 (per-turn latency) is **out of scope** — the data does not exist — and session duration is derived from existing `ts_ms` values, not from a new log field.
- New parsing is **additive and idempotent**: existing `UsageEvent` extraction and the `events` table are unchanged; re-syncing must not duplicate or corrupt anything. Tool calls are keyed by `(message_uuid, ordinal)`.
- Parsing stays tolerant: a missing/empty `content` array yields zero tool calls, never an error.
- Costs shown remain **estimates from list prices, not actual billing.**
- TypeScript `strict`; no `any`. Tests colocated as `*.test.ts` with relative imports.

---

### Task 1: Extract tool calls in the parser

**Files:**
- Modify: `src/lib/parse-claude-logs.ts`
- Test: `src/lib/parse-claude-logs.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolCallEvent { messageUuid: string; ordinal: number; sessionId: string; projectId: string; projectPath: string; tsMs: number; toolName: string }`
  - `parseLogContents(contents: string): { events: UsageEvent[]; toolCalls: ToolCallEvent[] }` (pure — no file I/O).
  - `parseLogFile(filePath: string): { events: UsageEvent[]; toolCalls: ToolCallEvent[] }` (now returns both).
  - `parseAllLogs(root?): { events: UsageEvent[]; toolCalls: ToolCallEvent[] }` (now returns both).

> Breaking-shape note: `parseLogFile`/`parseAllLogs` previously returned `UsageEvent[]`. Their consumers (`runSync` in `src/lib/sync.ts`) are updated in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/parse-claude-logs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLogContents, projectIdFor } from "./parse-claude-logs";

const cwd = "/home/me/proj";

const assistantLine = JSON.stringify({
  type: "assistant",
  uuid: "u1",
  sessionId: "s1",
  cwd,
  timestamp: "2026-06-01T00:00:00Z",
  message: {
    model: "claude-opus-4-8",
    role: "assistant",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    content: [
      { type: "thinking" },
      { type: "tool_use", name: "Read" },
      { type: "text" },
      { type: "tool_use", name: "Bash" },
    ],
  },
});

const userLine = JSON.stringify({ type: "user", uuid: "x", message: { role: "user" } });

describe("parseLogContents", () => {
  it("extracts one usage event and its tool calls in order", () => {
    const { events, toolCalls } = parseLogContents(`${assistantLine}\n${userLine}\n`);

    expect(events).toHaveLength(1);
    expect(events[0].uuid).toBe("u1");

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((t) => [t.ordinal, t.toolName])).toEqual([
      [0, "Read"],
      [1, "Bash"],
    ]);
    expect(toolCalls[0].messageUuid).toBe("u1");
    expect(toolCalls[0].sessionId).toBe("s1");
    expect(toolCalls[0].projectId).toBe(projectIdFor(cwd));
  });

  it("yields no tool calls when content is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "u2",
      sessionId: "s1",
      cwd,
      timestamp: "2026-06-01T00:00:00Z",
      message: {
        model: "claude-opus-4-8",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const { events, toolCalls } = parseLogContents(line);
    expect(events).toHaveLength(1);
    expect(toolCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/parse-claude-logs.test.ts`
Expected: FAIL — `parseLogContents` not exported.

- [ ] **Step 3: Add the ToolCallEvent type and content typing**

In `src/lib/parse-claude-logs.ts`, add the interface after the `UsageEvent` interface:

```ts
/** A single tool invocation within an assistant turn. */
export interface ToolCallEvent {
  /** uuid of the assistant message this call belongs to. */
  messageUuid: string;
  /** 0-based index among tool_use blocks in that message. */
  ordinal: number;
  sessionId: string;
  projectId: string;
  projectPath: string;
  tsMs: number;
  toolName: string;
}
```

Extend `RawLogLine`'s `message` shape to include content blocks — add to the `message?: { ... }` type:

```ts
    content?: Array<{ type?: string; name?: string }>;
```

- [ ] **Step 4: Extract `parseLogContents` and rewrite `parseLogFile`**

In `src/lib/parse-claude-logs.ts`, replace the existing `parseLogFile` function with a pure `parseLogContents` plus a thin file wrapper:

```ts
/** Parse JSONL text into usage events and tool calls. Malformed lines skipped. */
export function parseLogContents(contents: string): {
  events: UsageEvent[];
  toolCalls: ToolCallEvent[];
} {
  const events: UsageEvent[] = [];
  const toolCalls: ToolCallEvent[] = [];

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
    if (raw.message?.model === "<synthetic>") continue;

    let tsMs: number;
    try {
      tsMs = toEpochMs(raw.timestamp);
    } catch {
      continue;
    }

    const projectId = projectIdFor(raw.cwd);

    events.push({
      uuid: raw.uuid,
      sessionId: raw.sessionId,
      projectPath: raw.cwd,
      projectId,
      model: raw.message?.model ?? "unknown",
      timestamp: raw.timestamp,
      tsMs,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    });

    let ordinal = 0;
    for (const block of raw.message?.content ?? []) {
      if (block?.type !== "tool_use") continue;
      toolCalls.push({
        messageUuid: raw.uuid,
        ordinal,
        sessionId: raw.sessionId,
        projectId,
        projectPath: raw.cwd,
        tsMs,
        toolName: block.name ?? "unknown",
      });
      ordinal++;
    }
  }

  return { events, toolCalls };
}

/** Parse one JSONL file into usage events and tool calls. */
export function parseLogFile(filePath: string): {
  events: UsageEvent[];
  toolCalls: ToolCallEvent[];
} {
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return { events: [], toolCalls: [] };
  }
  return parseLogContents(contents);
}
```

- [ ] **Step 5: Update `parseAllLogs` to aggregate both**

Replace `parseAllLogs` with:

```ts
/** Parse every session log under the projects root. */
export function parseAllLogs(root = getProjectsRoot()): {
  events: UsageEvent[];
  toolCalls: ToolCallEvent[];
} {
  const events: UsageEvent[] = [];
  const toolCalls: ToolCallEvent[] = [];
  for (const file of listLogFiles(root)) {
    const parsed = parseLogFile(file);
    events.push(...parsed.events);
    toolCalls.push(...parsed.toolCalls);
  }
  return { events, toolCalls };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/lib/parse-claude-logs.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/parse-claude-logs.ts src/lib/parse-claude-logs.test.ts
git commit -m "feat: extract tool calls during log parsing"
```

---

### Task 2: `tool_calls` table + idempotent insert

**Files:**
- Modify: `src/lib/db.ts`
- Test: `src/lib/db.toolcalls.test.ts`

**Interfaces:**
- Consumes: `ToolCallEvent` from Task 1; `getDb`, `openMemoryDb`, `migrate` (private).
- Produces: `insertToolCalls(toolCalls: ToolCallEvent[], db?): number` — returns newly inserted count; re-inserting the same calls inserts nothing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/db.toolcalls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertToolCalls, openMemoryDb } from "./db";
import type { ToolCallEvent } from "./parse-claude-logs";

function call(messageUuid: string, ordinal: number, toolName: string): ToolCallEvent {
  return {
    messageUuid,
    ordinal,
    sessionId: "s1",
    projectId: "p",
    projectPath: "/p",
    tsMs: 1000,
    toolName,
  };
}

describe("insertToolCalls", () => {
  it("inserts new rows and is idempotent on re-insert", () => {
    const db = openMemoryDb();
    const rows = [call("u1", 0, "Read"), call("u1", 1, "Bash")];
    expect(insertToolCalls(rows, db)).toBe(2);
    expect(insertToolCalls(rows, db)).toBe(0); // same (message_uuid, ordinal)
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/db.toolcalls.test.ts`
Expected: FAIL — `insertToolCalls` not exported.

- [ ] **Step 3: Add the table to the migration**

In `src/lib/db.ts`, inside the `migrate` `database.exec(\`...\`)` template (after the `settings` table if Phase 2 added one, otherwise after the event indexes), add:

```sql
    CREATE TABLE IF NOT EXISTS tool_calls (
      message_uuid TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      ts_ms INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      PRIMARY KEY (message_uuid, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls (tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls (project_id);
```

- [ ] **Step 4: Add `insertToolCalls`**

In `src/lib/db.ts`, add `import type { ToolCallEvent } from "./parse-claude-logs";` to the existing type import line (or a new import), then add after `insertEvents`:

```ts
/** Insert tool calls idempotently (keyed by message_uuid + ordinal). */
export function insertToolCalls(
  toolCalls: ToolCallEvent[],
  database: Database.Database = getDb(),
): number {
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO tool_calls (
      message_uuid, ordinal, session_id, project_id, project_path, ts_ms, tool_name
    ) VALUES (
      @messageUuid, @ordinal, @sessionId, @projectId, @projectPath, @tsMs, @toolName
    )
  `);

  const insertMany = database.transaction((rows: ToolCallEvent[]) => {
    let inserted = 0;
    for (const row of rows) inserted += stmt.run(row).changes;
    return inserted;
  });

  return insertMany(toolCalls);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/db.toolcalls.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/db.toolcalls.test.ts
git commit -m "feat: add idempotent tool_calls persistence"
```

---

### Task 3: Wire tool calls into sync

**Files:**
- Modify: `src/lib/sync.ts`

**Interfaces:**
- Consumes: updated `parseAllLogs` (Task 1), `insertEvents`, `insertToolCalls` (Task 2).
- Produces: `interface SyncResult { parsed: number; inserted: number; toolCallsParsed: number; toolCallsInserted: number }`; `runSync()` returns it.

> Consumer note: `/api/sync` returns `runSync()` verbatim and the Sync button reads `inserted`/`parsed` — both keys are preserved, so no client change is required.

- [ ] **Step 1: Update runSync**

Replace `src/lib/sync.ts` with:

```ts
import { insertEvents, insertToolCalls } from "./db";
import { parseAllLogs } from "./parse-claude-logs";

export interface SyncResult {
  parsed: number;
  inserted: number;
  toolCallsParsed: number;
  toolCallsInserted: number;
}

/** Parse all Claude Code session logs and upsert events + tool calls. */
export function runSync(): SyncResult {
  const { events, toolCalls } = parseAllLogs();
  const inserted = insertEvents(events);
  const toolCallsInserted = insertToolCalls(toolCalls);
  return {
    parsed: events.length,
    inserted,
    toolCallsParsed: toolCalls.length,
    toolCallsInserted,
  };
}
```

- [ ] **Step 2: Verify typecheck + a real sync**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm sync`
Expected: completes without error (it now also populates `tool_calls`). Re-run `pnpm sync`; expect `0` newly inserted on the second run (idempotent).

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync.ts
git commit -m "feat: persist tool calls during sync"
```

---

### Task 4: Tool-usage queries + session duration / avg-per-turn

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/format.ts` (add `formatDuration`)
- Test: `src/lib/queries.tools.test.ts`
- Test: `src/lib/format.duration.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolUsageRow { toolName: string; count: number }`
  - `getToolUsage(db?): ToolUsageRow[]` (all projects, desc by count)
  - `getToolUsageByProject(projectId: string, db?): ToolUsageRow[]`
  - `SessionRow` gains `durationMs: number` and `avgTokensPerTurn: number`; `getSessions(projectId, db?)` populates them.
  - `formatDuration(ms: number): string` (e.g. `"2h 13m"`, `"4m"`, `"0m"`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/format.duration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration((2 * 60 + 13) * 60_000)).toBe("2h 13m");
  });
  it("formats minutes only under an hour", () => {
    expect(formatDuration(4 * 60_000)).toBe("4m");
  });
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0m");
  });
});
```

Create `src/lib/queries.tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertToolCalls, openMemoryDb } from "./db";
import type { ToolCallEvent } from "./parse-claude-logs";
import { getToolUsage } from "./queries";

function call(messageUuid: string, ordinal: number, toolName: string): ToolCallEvent {
  return {
    messageUuid,
    ordinal,
    sessionId: "s1",
    projectId: "p",
    projectPath: "/p",
    tsMs: 1000,
    toolName,
  };
}

describe("getToolUsage", () => {
  it("counts tool calls by name, most-used first", () => {
    const db = openMemoryDb();
    insertToolCalls(
      [call("a", 0, "Read"), call("a", 1, "Read"), call("b", 0, "Bash")],
      db,
    );
    const rows = getToolUsage(db);
    expect(rows[0]).toEqual({ toolName: "Read", count: 2 });
    expect(rows[1]).toEqual({ toolName: "Bash", count: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/format.duration.test.ts src/lib/queries.tools.test.ts`
Expected: FAIL — `formatDuration` / `getToolUsage` not exported.

- [ ] **Step 3: Add `formatDuration`**

In `src/lib/format.ts`, add:

```ts
/** Milliseconds as a compact duration, e.g. "2h 13m", "4m", "0m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
```

- [ ] **Step 4: Add the tool-usage queries**

In `src/lib/queries.ts`, add before `export { timeZone };`:

```ts
export interface ToolUsageRow {
  toolName: string;
  count: number;
}

/** Tool-call counts across all projects, most-used first. */
export function getToolUsage(
  database: DatabaseType.Database = getDb(),
): ToolUsageRow[] {
  return database
    .prepare(
      `SELECT tool_name AS toolName, COUNT(*) AS count
       FROM tool_calls
       GROUP BY tool_name
       ORDER BY count DESC`,
    )
    .all() as ToolUsageRow[];
}

/** Tool-call counts for a single project, most-used first. */
export function getToolUsageByProject(
  projectId: string,
  database: DatabaseType.Database = getDb(),
): ToolUsageRow[] {
  return database
    .prepare(
      `SELECT tool_name AS toolName, COUNT(*) AS count
       FROM tool_calls
       WHERE project_id = ?
       GROUP BY tool_name
       ORDER BY count DESC`,
    )
    .all(projectId) as ToolUsageRow[];
}
```

- [ ] **Step 5: Extend `getSessions` with duration and avg-per-turn**

In `src/lib/queries.ts`, update the `SessionRow` interface to add two fields:

```ts
  durationMs: number;
  avgTokensPerTurn: number;
```

Update `getSessions` to accept an optional db, select `MIN(ts_ms)`, and compute the new fields in the `.map`. Replace the function with:

```ts
export function getSessions(
  projectId: string,
  database: DatabaseType.Database = getDb(),
): SessionRow[] {
  const rows = database
    .prepare(
      `SELECT session_id AS sessionId,
              MAX(ts_ms) AS lastActiveMs,
              MIN(ts_ms) AS firstMs,
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
    Omit<SessionRow, "cacheHitRate" | "durationMs" | "avgTokensPerTurn"> & {
      reads: number;
      inputs: number;
      firstMs: number;
    }
  >;

  return rows.map((r) => ({
    sessionId: r.sessionId,
    lastActiveMs: r.lastActiveMs,
    turns: r.turns,
    totalTokens: r.totalTokens,
    estimatedCost: r.estimatedCost,
    cacheHitRate: r.reads + r.inputs === 0 ? 0 : r.reads / (r.reads + r.inputs),
    durationMs: r.lastActiveMs - r.firstMs,
    avgTokensPerTurn: r.turns === 0 ? 0 : Math.round(r.totalTokens / r.turns),
  }));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/lib/format.duration.test.ts src/lib/queries.tools.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all pass (the `SessionRow` change is consumed by `sessions-table.tsx`, updated in Task 5 — if typecheck flags missing columns there, that is expected until Task 5; run this step again after Task 5).

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries.ts src/lib/format.ts src/lib/queries.tools.test.ts src/lib/format.duration.test.ts
git commit -m "feat: tool-usage queries and session duration/avg-per-turn"
```

---

### Task 5: Tools page + session columns

**Files:**
- Create: `src/components/tool-usage-chart.tsx`
- Create: `src/app/(dashboard)/tools/page.tsx`
- Modify: `src/components/app-sidebar.tsx` (add Tools nav item)
- Modify: `src/components/sessions-table.tsx` (duration + avg/turn columns)

**Interfaces:**
- Consumes: `getToolUsage`, `ToolUsageRow` (Task 4); `formatDuration`, `formatTokens`, `formatInt`.
- Produces: a Tools page and two new session columns. UI task — verified by typecheck + visual.

- [ ] **Step 1: Create the tool-usage chart**

Create `src/components/tool-usage-chart.tsx`:

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatInt } from "@/lib/format";
import type { ToolUsageRow } from "@/lib/queries";

const chartConfig = {
  count: { label: "Calls", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Horizontal bar chart of tool-call counts. */
export function ToolUsageChart({ data }: { data: ToolUsageRow[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[360px] w-full">
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 8 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatInt(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="toolName"
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 2, 2, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Create the Tools page**

Create `src/app/(dashboard)/tools/page.tsx`:

```tsx
import { ToolUsageChart } from "@/components/tool-usage-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getToolUsage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  const usage = getToolUsage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool usage</CardTitle>
        <CardDescription>
          How often each tool was called across all sessions. Run Sync to refresh.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tool calls recorded yet. Click Sync to import them.
          </p>
        ) : (
          <ToolUsageChart data={usage} />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Add the Tools nav item**

In `src/components/app-sidebar.tsx`, add `Wrench` to the `lucide-react` import and add an entry to the `NAV` array:

```tsx
  { title: "Tools", href: "/tools", icon: Wrench },
```

- [ ] **Step 4: Add duration + avg/turn columns to the sessions table**

In `src/components/sessions-table.tsx`, add `formatDuration` to the `@/lib/format` import, and add two columns to the `columns` array (place after the `turns` column):

```tsx
  {
    accessorKey: "durationMs",
    header: ({ column }) => <SortableHeader label="Duration" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDuration(row.original.durationMs)}</span>
    ),
  },
  {
    accessorKey: "avgTokensPerTurn",
    header: ({ column }) => <SortableHeader label="Avg/turn" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatTokens(row.original.avgTokensPerTurn)}</span>
    ),
  },
```

(`formatTokens` is already imported in this file.)

- [ ] **Step 5: Verify typecheck + render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm sync` (to populate tool calls), then `pnpm dev`. Confirm: a "Tools" item in the sidebar opens a tool-usage bar chart; a project's sessions table shows Duration and Avg/turn columns. Stop the server.

- [ ] **Step 6: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/tool-usage-chart.tsx "src/app/(dashboard)/tools/page.tsx" src/components/app-sidebar.tsx src/components/sessions-table.tsx
git commit -m "feat: tools page and session duration/avg-per-turn columns"
```

---

## Self-Review

- **Spec coverage (stories 16–23):** most-used tools overall (16) → Tasks 4–5; tool usage per project (17) → Task 4 (`getToolUsageByProject` query built; surfacing it on the project page is a trivial follow-up using the existing card pattern — noted); session duration (18) → Task 4 (`durationMs`) + Task 5 column; per-turn latency (19) → **out of scope, data not present in logs** (documented in Global Constraints); turns + avg tokens/turn (20) → Task 4 (`avgTokensPerTurn`) + Task 5; idempotent re-runnable parse (21) → Task 2 (PK `(message_uuid, ordinal)`, `INSERT OR IGNORE`) + Task 3 verification; graceful degradation on missing fields (22) → Task 1 (empty/absent `content` → no tool calls); existing token/cost data unaffected (23) → Tasks 1–3 are purely additive; the `events` table and `insertEvents` are untouched.
- **Placeholder scan:** every code step is complete; commands include expected output; the story-17 "follow-up" and story-19 "out of scope" are explicit decisions, not gaps.
- **Type consistency:** `ToolCallEvent` fields match across Tasks 1, 2, 4 tests; `insertToolCalls(rows, db?)` signature consistent (Tasks 2, 3); `ToolUsageRow` identical in query (Task 4) and chart (Task 5); `SessionRow` new fields `durationMs`/`avgTokensPerTurn` defined in Task 4 and consumed in Task 5; `SyncResult` preserves `parsed`/`inserted` so the existing `/api/sync` consumer and Sync button keep working.
- **Cross-phase note:** if Phase 2 added the `settings` table to `migrate`, place the `tool_calls` table after it in the same `exec` block — order is irrelevant since each is `CREATE TABLE IF NOT EXISTS`.
