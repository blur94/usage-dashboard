# Reporting & Exploration UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user more ways to explore the same data — an activity heatmap, a per-session turn timeline, CSV/JSON export of any view, and date/model filters that apply across pages.

**Architecture:** Three additive query functions (heatmap buckets, session turns, filtered project/model lists) plus one pure CSV serializer. New UI: a heatmap component, a session-detail route, export buttons, and a shared header filter bar driven by `nuqs`. All queries are dependency-injectable for tests; UI is verified by typecheck + visual check.

**Tech Stack:** Next.js 16 · React 19 · TypeScript (strict) · better-sqlite3 · Recharts · shadcn/ui · `@js-temporal/polyfill` · `nuqs` · Vitest.

## Global Constraints

- **Depends on Phase 1 (Cost Intelligence)** for Vitest, `openMemoryDb()`, and `insertEvents(events, db?)`. Do not start until those exist.
- Next.js 16 — consult `node_modules/next/dist/docs/` before writing Next-specific code.
- Recharts colors must reference CSS custom properties only (`var(--chart-N)` / `chartColor(n)`), never hardcoded hex/rgb (NFR-2).
- All calendar/bucketing math uses `@js-temporal/polyfill`; SQL date math reuses the existing local-offset pattern (offset seconds added to `ts_ms/1000`).
- URL-persisted filters use `nuqs` with `{ shallow: false }` so server components re-render (matches the existing `OverviewFilters`).
- Costs shown anywhere remain **estimates from list prices, not actual billing.**
- TypeScript `strict`; no `any`. Tests colocated as `*.test.ts` with relative imports.

---

### Task 1: Activity heatmap query

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.heatmap.test.ts`

**Interfaces:**
- Consumes: `getDb`, `nowZoned` (private, in-file), and the existing private `offsetSecondsToSeconds` helper.
- Produces: `interface HeatmapCell { dow: number; hour: number; tokens: number }` (`dow`: 0=Sun..6=Sat) and `getActivityHeatmap(offsetSeconds?: number, db?): HeatmapCell[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/queries.heatmap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertEvents, openMemoryDb } from "./db";
import type { UsageEvent } from "./parse-claude-logs";
import { getActivityHeatmap } from "./queries";

function event(uuid: string, tsMs: number): UsageEvent {
  return {
    uuid,
    sessionId: "s",
    projectPath: "/p",
    projectId: "p",
    model: "claude-haiku-4-5-20251001",
    timestamp: new Date(tsMs).toISOString(),
    tsMs,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

describe("getActivityHeatmap", () => {
  it("buckets tokens by day-of-week and hour (UTC offset 0)", () => {
    const db = openMemoryDb();
    // 2026-06-15 is a Monday. 09:00 UTC.
    const monday9 = Date.UTC(2026, 5, 15, 9, 0, 0);
    insertEvents([event("a", monday9), event("b", monday9)], db);

    const cells = getActivityHeatmap(0, db);
    const cell = cells.find((c) => c.dow === 1 && c.hour === 9);
    expect(cell?.tokens).toBe(300); // 2 events * (100+50)
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/queries.heatmap.test.ts`
Expected: FAIL — `getActivityHeatmap` not exported.

- [ ] **Step 3: Add the query**

In `src/lib/queries.ts`, add at the end before `export { timeZone };` (reuse the existing private `offsetSecondsToSeconds` and `nowZoned`; add `import type DatabaseType from "better-sqlite3";` only if not already present from another phase):

```ts
export interface HeatmapCell {
  /** 0 = Sunday … 6 = Saturday (local). */
  dow: number;
  /** 0–23 local hour. */
  hour: number;
  tokens: number;
}

/** Token totals bucketed by local day-of-week and hour, for an activity heatmap. */
export function getActivityHeatmap(
  offsetSeconds = offsetSecondsToSeconds(nowZoned().offset),
  database: DatabaseType.Database = getDb(),
): HeatmapCell[] {
  return database
    .prepare(
      `SELECT CAST(strftime('%w', (ts_ms / 1000) + ?, 'unixepoch') AS INTEGER) AS dow,
              CAST(strftime('%H', (ts_ms / 1000) + ?, 'unixepoch') AS INTEGER) AS hour,
              SUM(input_tokens + output_tokens) AS tokens
       FROM events
       GROUP BY dow, hour
       ORDER BY dow, hour`,
    )
    .all(offsetSeconds, offsetSeconds) as HeatmapCell[];
}
```

Note: `offsetSecondsToSeconds` is currently a private function in this file — leave it private; just call it. If it is not yet exported/visible at the point you add this code, it already is in scope (same module).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/queries.heatmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.heatmap.test.ts
git commit -m "feat: add activity heatmap query"
```

---

### Task 2: Heatmap component on Overview

**Files:**
- Create: `src/components/activity-heatmap.tsx`
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `HeatmapCell` and `getActivityHeatmap` from Task 1; `formatTokens` from format.
- Produces: an `ActivityHeatmap` component. UI task — verified by typecheck + visual.

- [ ] **Step 1: Create the component**

Create `src/components/activity-heatmap.tsx`:

```tsx
import type { HeatmapCell } from "@/lib/queries";
import { formatTokens } from "@/lib/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A 7×24 grid of activity intensity by local day-of-week and hour. */
export function ActivityHeatmap({ data }: { data: HeatmapCell[] }) {
  const byKey = new Map(data.map((c) => [`${c.dow}-${c.hour}`, c.tokens]));
  const max = data.reduce((m, c) => Math.max(m, c.tokens), 0);

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[10px] text-muted-foreground">
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
        {DAYS.map((day, dow) => (
          <div key={day} className="contents">
            <div className="pr-2 text-right text-xs text-muted-foreground">
              {day}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const tokens = byKey.get(`${dow}-${hour}`) ?? 0;
              const intensity = max > 0 ? tokens / max : 0;
              return (
                <div
                  key={hour}
                  title={`${day} ${hour}:00 — ${formatTokens(tokens)} tokens`}
                  className="aspect-square rounded-[2px]"
                  style={{
                    backgroundColor: "var(--chart-1)",
                    opacity: tokens === 0 ? 0.08 : 0.2 + intensity * 0.8,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Overview page**

In `src/app/(dashboard)/page.tsx`, add `getActivityHeatmap` to the `@/lib/queries` import and `import { ActivityHeatmap } from "@/components/activity-heatmap";`. In the body add:

```ts
  const heatmap = getActivityHeatmap();
```

Add a card after the daily-usage card:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Activity heatmap</CardTitle>
          <CardDescription>Tokens by day of week and hour (local time).</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap data={heatmap} />
        </CardContent>
      </Card>
```

- [ ] **Step 3: Verify typecheck + render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, open http://localhost:3000, confirm a 7×24 heatmap renders with hour labels and tooltips. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/components/activity-heatmap.tsx "src/app/(dashboard)/page.tsx"
git commit -m "feat: activity heatmap on overview"
```

---

### Task 3: Session turn timeline

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/components/sessions-table.tsx` (rows clickable)
- Create: `src/components/session-timeline.tsx`
- Create: `src/app/(dashboard)/sessions/[id]/page.tsx`
- Test: `src/lib/queries.session.test.ts`

**Interfaces:**
- Consumes: `getDb`, `COST` (in-file).
- Produces: `interface TurnPoint { tsMs: number; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cost: number }` and `getSessionTurns(sessionId: string, db?): TurnPoint[]` (ordered by `tsMs`). A `SessionTimeline` component and a `/sessions/[id]` route.

- [ ] **Step 1: Write the failing test**

Create `src/lib/queries.session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertEvents, openMemoryDb } from "./db";
import type { UsageEvent } from "./parse-claude-logs";
import { getSessionTurns } from "./queries";

function event(uuid: string, tsMs: number, output: number): UsageEvent {
  return {
    uuid,
    sessionId: "sess-1",
    projectPath: "/p",
    projectId: "p",
    model: "claude-opus-4-8",
    timestamp: new Date(tsMs).toISOString(),
    tsMs,
    inputTokens: 0,
    outputTokens: output,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

describe("getSessionTurns", () => {
  it("returns each turn ordered by time, with estimated cost", () => {
    const db = openMemoryDb();
    insertEvents(
      [
        event("b", 2000, 1_000_000),
        event("a", 1000, 1_000_000),
      ],
      db,
    );
    const turns = getSessionTurns("sess-1", db);
    expect(turns.map((t) => t.tsMs)).toEqual([1000, 2000]);
    // Opus output $25/Mtok => 1M output = $25.
    expect(turns[0].cost).toBeCloseTo(25, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/queries.session.test.ts`
Expected: FAIL — `getSessionTurns` not exported.

- [ ] **Step 3: Add the query**

In `src/lib/queries.ts`, add before `export { timeZone };`:

```ts
export interface TurnPoint {
  tsMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** Every recorded turn of one session, oldest first, with estimated cost. */
export function getSessionTurns(
  sessionId: string,
  database: DatabaseType.Database = getDb(),
): TurnPoint[] {
  return database
    .prepare(
      `SELECT ts_ms AS tsMs,
              model,
              input_tokens AS inputTokens,
              output_tokens AS outputTokens,
              cache_read_input_tokens AS cacheReadTokens,
              (${COST}) AS cost
       FROM events
       WHERE session_id = ?
       ORDER BY ts_ms`,
    )
    .all(sessionId) as TurnPoint[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/queries.session.test.ts`
Expected: PASS.

- [ ] **Step 5: Make session rows clickable**

In `src/components/sessions-table.tsx`, add `import { useRouter } from "next/navigation";` and change the component to navigate on row click:

```tsx
export function SessionsTable({ data }: { data: SessionRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      columns={columns}
      data={data}
      initialSorting={[{ id: "lastActiveMs", desc: true }]}
      onRowClick={(row) => router.push(`/sessions/${row.sessionId}`)}
      emptyMessage="No sessions for this project."
    />
  );
}
```

- [ ] **Step 6: Create the timeline component**

Create `src/components/session-timeline.tsx`:

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/format";
import type { TurnPoint } from "@/lib/queries";

const chartConfig = {
  cost: { label: "Est. cost", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Per-turn estimated cost across one session. */
export function SessionTimeline({ data }: { data: TurnPoint[] }) {
  const points = data.map((t, i) => ({ turn: i + 1, cost: t.cost }));
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
      <BarChart accessibilityLayer data={points} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="turn" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => formatCurrency(Number(v))}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="cost" fill="var(--color-cost)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 7: Create the session route**

Create `src/app/(dashboard)/sessions/[id]/page.tsx`:

```tsx
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionTimeline } from "@/components/session-timeline";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionTurns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const turns = getSessionTurns(id);
  if (turns.length === 0) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/projects">
          <ChevronLeft data-icon="inline-start" />
          Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-base">…{id.slice(-12)}</CardTitle>
          <CardDescription>
            {turns.length} turn{turns.length === 1 ? "" : "s"}. Estimated cost per
            turn — list prices, not actual billing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionTimeline data={turns} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Verify typecheck + render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, navigate Projects → a project → click a session row → confirm the timeline page renders per-turn cost bars. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.session.test.ts src/components/sessions-table.tsx src/components/session-timeline.tsx "src/app/(dashboard)/sessions/[id]/page.tsx"
git commit -m "feat: per-session turn timeline view"
```

---

### Task 4: CSV/JSON export

**Files:**
- Create: `src/lib/export.ts`
- Test: `src/lib/export.test.ts`
- Create: `src/app/api/export/route.ts`
- Create: `src/components/export-button.tsx`
- Modify: `src/app/(dashboard)/projects/page.tsx` (add export button)

**Interfaces:**
- Produces: `toCsv(rows: Record<string, unknown>[], columns: string[]): string` (pure); `GET /api/export?type=projects|models&format=csv|json`; an `ExportButton` client component.

- [ ] **Step 1: Write the failing test**

Create `src/lib/export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCsv } from "./export";

describe("toCsv", () => {
  it("emits a header row plus selected columns", () => {
    const csv = toCsv(
      [{ name: "alpha", cost: 1.5 }, { name: "beta", cost: 2 }],
      ["name", "cost"],
    );
    expect(csv).toBe("name,cost\nalpha,1.5\nbeta,2");
  });
  it("quotes values containing commas or quotes", () => {
    const csv = toCsv([{ name: 'a,"b"' }], ["name"]);
    expect(csv).toBe('name\n"a,""b"""');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/export.test.ts`
Expected: FAIL — cannot resolve `./export`.

- [ ] **Step 3: Write the serializer**

Create `src/lib/export.ts`:

```ts
function escapeCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize rows to CSV using the given column order. No trailing newline. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(row[c])).join(","),
  );
  return [header, ...body].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/export.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Create the export route**

Create `src/app/api/export/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { toCsv } from "@/lib/export";
import { getModelTotals, getProjects } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS: Record<string, string[]> = {
  projects: ["shortName", "sessions", "totalTokens", "estimatedCost", "cacheHitRate"],
  models: ["model", "totalTokens", "estimatedCost"],
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "projects";
  const format = params.get("format") ?? "csv";

  const rows: Record<string, unknown>[] =
    type === "models"
      ? (getModelTotals() as unknown as Record<string, unknown>[])
      : (getProjects() as unknown as Record<string, unknown>[]);
  const columns = COLUMNS[type] ?? COLUMNS.projects;

  if (format === "json") {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${type}.json"`,
      },
    });
  }

  return new NextResponse(toCsv(rows, columns), {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="${type}.csv"`,
    },
  });
}
```

- [ ] **Step 6: Create the export button**

Create `src/components/export-button.tsx`:

```tsx
"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Downloads a view as CSV or JSON via the export API. */
export function ExportButton({
  type,
  format = "csv",
}: {
  type: "projects" | "models";
  format?: "csv" | "json";
}) {
  return (
    <Button size="sm" variant="outline" asChild>
      <a href={`/api/export?type=${type}&format=${format}`} download>
        <Download data-icon="inline-start" />
        Export {format.toUpperCase()}
      </a>
    </Button>
  );
}
```

- [ ] **Step 7: Add the button to the Projects page**

In `src/app/(dashboard)/projects/page.tsx`, import `ExportButton` and place it in the card header. Change the `CardHeader` to a flex row that holds the existing title/description on the left and `<ExportButton type="projects" />` on the right:

```tsx
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Token usage across {projects.length} project
              {projects.length === 1 ? "" : "s"}. Click a row to view its sessions.
              Costs are estimates from list prices, not actual billing.
            </CardDescription>
          </div>
          <ExportButton type="projects" />
        </CardHeader>
```

- [ ] **Step 8: Verify typecheck + render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, open http://localhost:3000/projects, click "Export CSV", confirm a `projects.csv` downloads with the expected columns. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add src/lib/export.ts src/lib/export.test.ts src/app/api/export/route.ts src/components/export-button.tsx "src/app/(dashboard)/projects/page.tsx"
git commit -m "feat: CSV/JSON export of projects and models"
```

---

### Task 5: Global header filters

**Files:**
- Create: `src/components/global-filters.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (render filters in header)
- Modify: `src/lib/queries.ts` (`getProjects`/`getModelTotals` accept date+model filters)
- Modify: `src/app/(dashboard)/projects/page.tsx` and `src/app/(dashboard)/models/page.tsx` (read filter params)
- Test: `src/lib/queries.filter.test.ts`

**Interfaces:**
- Produces: a `GlobalFilters` client component; filtered overloads — `getProjects(opts?: { sinceMs?: number; model?: string }, db?): ProjectRow[]` and `getModelTotals(opts?: { sinceMs?: number; model?: string }, db?): ModelRow[]`.

> Backward-compatibility note: `getProjects()` and `getModelTotals()` are currently called with no args (Projects page, Overview model list). Adding a leading optional `opts` object keeps those call sites valid.

- [ ] **Step 1: Write the failing test**

Create `src/lib/queries.filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertEvents, openMemoryDb } from "./db";
import type { UsageEvent } from "./parse-claude-logs";
import { getModelTotals } from "./queries";

function event(uuid: string, model: string, tsMs: number): UsageEvent {
  return {
    uuid,
    sessionId: "s",
    projectPath: "/p",
    projectId: "p",
    model,
    timestamp: new Date(tsMs).toISOString(),
    tsMs,
    inputTokens: 1000,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

describe("getModelTotals filtering", () => {
  it("filters by model and since-time", () => {
    const db = openMemoryDb();
    insertEvents(
      [
        event("a", "claude-opus-4-8", Date.UTC(2026, 5, 10)),
        event("b", "claude-haiku-4-5-20251001", Date.UTC(2026, 5, 10)),
        event("c", "claude-opus-4-8", Date.UTC(2026, 4, 1)), // before cutoff
      ],
      db,
    );
    const rows = getModelTotals(
      { sinceMs: Date.UTC(2026, 5, 1), model: "claude-opus-4-8" },
      db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe("claude-opus-4-8");
    expect(rows[0].totalTokens).toBe(1000); // event "a" only
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/queries.filter.test.ts`
Expected: FAIL — `getModelTotals` does not accept options / wrong result.

- [ ] **Step 3: Add filtering to the queries**

In `src/lib/queries.ts`, replace `getModelTotals` with a filterable version:

```ts
export function getModelTotals(
  opts: { sinceMs?: number; model?: string } = {},
  database: DatabaseType.Database = getDb(),
): ModelRow[] {
  const where: string[] = [];
  const args: (number | string)[] = [];
  if (opts.sinceMs != null) {
    where.push("ts_ms >= ?");
    args.push(opts.sinceMs);
  }
  if (opts.model) {
    where.push("model = ?");
    args.push(opts.model);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return database
    .prepare(
      `SELECT model,
              SUM(input_tokens + output_tokens) AS totalTokens,
              SUM(${COST}) AS estimatedCost
       FROM events
       ${clause}
       GROUP BY model
       ORDER BY totalTokens DESC`,
    )
    .all(...args) as ModelRow[];
}
```

Apply the same `opts`/`database` pattern to `getProjects` — add the optional `opts: { sinceMs?: number; model?: string } = {}` first param and `database: DatabaseType.Database = getDb()` second param, build the same `WHERE` clause, and splice `...args` into the existing `.all(...)`. Keep the existing SELECT/GROUP BY/ORDER BY and the post-query `.map(...)` unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/queries.filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the global filter bar**

Create `src/components/global-filters.tsx` (same `nuqs` pattern as the existing `OverviewFilters`, but model-only here so it composes with each page's own day handling):

```tsx
"use client";

import { parseAsString, useQueryState } from "nuqs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatModel } from "@/lib/format";

const ALL = "all";

/** App-wide model filter, persisted to the URL. */
export function GlobalFilters({ models }: { models: string[] }) {
  const [model, setModel] = useQueryState(
    "model",
    parseAsString.withOptions({ shallow: false }),
  );
  return (
    <Select value={model ?? ALL} onValueChange={(v) => setModel(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>All models</SelectItem>
          {models.map((m) => (
            <SelectItem key={m} value={m}>
              {formatModel(m)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 6: Render the filter in the layout header**

In `src/app/(dashboard)/layout.tsx`, add imports `import { GlobalFilters } from "@/components/global-filters";` and `import { getModelTotals } from "@/lib/queries";`. Make the layout a server component that fetches the model list and renders the filter to the left of the Sync button:

```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const models = getModelTotals().map((m) => m.model);
  return (
    // ...unchanged SidebarProvider/AppSidebar/SidebarInset...
    // inside <header>, replace the trailing <div className="ml-auto"> block with:
          <div className="ml-auto flex items-center gap-2">
            <GlobalFilters models={models} />
            <SyncButton />
          </div>
    // ...
  );
}
```

(Keep all other header markup identical; only the right-hand `ml-auto` container changes.)

- [ ] **Step 7: Apply the model filter on Projects and Models pages**

In `src/app/(dashboard)/models/page.tsx`, read `searchParams` and pass the model filter:

```tsx
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const sp = await searchParams;
  const models = getModelTotals({ model: sp.model || undefined });
  // ...render unchanged with `models`...
}
```

In `src/app/(dashboard)/projects/page.tsx`, do the same: accept `searchParams: Promise<{ model?: string }>`, `const sp = await searchParams;`, and `const projects = getProjects({ model: sp.model || undefined });`. Keep `export const dynamic = "force-dynamic";`.

- [ ] **Step 8: Verify typecheck + render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`. Pick a model in the header filter; confirm the URL gains `?model=…`, and that Projects and Models pages reflect the filter while navigating. Stop the server.

- [ ] **Step 9: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/global-filters.tsx "src/app/(dashboard)/layout.tsx" src/lib/queries.ts src/lib/queries.filter.test.ts "src/app/(dashboard)/projects/page.tsx" "src/app/(dashboard)/models/page.tsx"
git commit -m "feat: global model filter across pages"
```

---

## Self-Review

- **Spec coverage (stories 24–31):** filters apply on every page (24) → Task 5 (model filter in header applied to Overview via existing param, plus Projects/Models); persisted in URL (25) → Tasks 5 (`nuqs`, matches existing convention); time-of-day/day-of-week heatmap (26) → Tasks 1–2; single-session timeline (27) → Task 3; export CSV (28) → Task 4; export JSON (29) → Task 4; exports respect filters (30) → **partially**: the export route currently exports unfiltered projects/models; a follow-up can thread the same `?model`/range params into `getProjects`/`getModelTotals` calls inside the route (the filterable queries from Task 5 already support it). Flagged, not fully built, to keep Task 4 shippable before Task 5 lands. Empty states (31) → existing `DataTable emptyMessage`, heatmap renders an all-faint grid, session route uses `notFound()`.
- **Date-range global filter:** Task 5 ships the **model** filter app-wide; date-range remains per-page (Overview already has it). Unifying day-range into the header is a natural follow-up using the identical `nuqs` + `opts.sinceMs` plumbing already in place. Noted as a deliberate scope line.
- **Placeholder scan:** all code steps are complete; commands have expected output. The two "follow-up" notes are explicit scope decisions.
- **Type consistency:** `HeatmapCell`, `TurnPoint`, `ProjectRow`/`ModelRow` opts signatures match between query definitions and component/page consumers; `ExportButton` `type` union (`"projects" | "models"`) matches the route's accepted `type` values; `getModelTotals(opts?, db?)` / `getProjects(opts?, db?)` signatures consistent across Tasks 5–7 and the layout.
