# Budgets, Alerts & Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set a local monthly USD budget and see month-end spend projected from run rate, a clear ok/approaching/over status, and week/month-over-month deltas on KPI cards.

**Architecture:** Two pure deep modules — `projection` (run-rate → projected month-end + status) and `deltas` (period-over-period change) — hold all the logic and are unit-tested in isolation. Budget/threshold persist in a new local `settings` key/value table (read/written via a small `settings` module and a `/api/settings` route). The Overview server component composes these with the existing cost queries. Local-only; no external storage.

**Tech Stack:** Next.js 16 · React 19 · TypeScript (strict) · better-sqlite3 · `@js-temporal/polyfill` · Vitest.

## Global Constraints

- **Depends on Phase 1 (Cost Intelligence)** being merged: this plan uses `pnpm test`/Vitest, `openMemoryDb()`, `insertEvents(events, db?)`, and `getCostInsightThisMonth()`. Do not start until those exist.
- Next.js 16 — consult `node_modules/next/dist/docs/` before writing Next-specific code.
- All cost figures remain **estimates from list prices, not actual billing** — keep that labeling on every budget surface.
- All calendar math uses `@js-temporal/polyfill` (`Temporal`); never native `Date`.
- Budget data stays local (SQLite `settings` table). No network egress.
- TypeScript `strict`; no `any`.
- The feature is opt-in: with no budget set, budget UI is omitted and the rest of the dashboard is unaffected.
- Tests colocated as `*.test.ts` with relative imports.

---

### Task 1: `deltas` pure module

**Files:**
- Create: `src/lib/deltas.ts`
- Test: `src/lib/deltas.test.ts`

**Interfaces:**
- Produces: `type Direction = "up" | "down" | "flat"`; `interface Delta { abs: number; pct: number | null; direction: Direction }`; `delta(current: number, previous: number): Delta`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/deltas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { delta } from "./deltas";

describe("delta", () => {
  it("computes an increase", () => {
    expect(delta(150, 100)).toEqual({ abs: 50, pct: 0.5, direction: "up" });
  });
  it("computes a decrease", () => {
    expect(delta(80, 100)).toEqual({ abs: -20, pct: -0.2, direction: "down" });
  });
  it("reports flat with zero change", () => {
    expect(delta(100, 100)).toEqual({ abs: 0, pct: 0, direction: "flat" });
  });
  it("returns null pct when the baseline is zero", () => {
    expect(delta(50, 0)).toEqual({ abs: 50, pct: null, direction: "up" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/deltas.test.ts`
Expected: FAIL — cannot resolve `./deltas`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/deltas.ts`:

```ts
export type Direction = "up" | "down" | "flat";

export interface Delta {
  /** current − previous. */
  abs: number;
  /** Fractional change vs. previous, or null when previous is 0. */
  pct: number | null;
  direction: Direction;
}

/** Period-over-period change between two scalar totals. */
export function delta(current: number, previous: number): Delta {
  const abs = current - previous;
  const pct = previous === 0 ? null : abs / previous;
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, direction };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/deltas.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deltas.ts src/lib/deltas.test.ts
git commit -m "feat: add deltas module for period-over-period change"
```

---

### Task 2: `projection` pure module

**Files:**
- Create: `src/lib/projection.ts`
- Test: `src/lib/projection.test.ts`

**Interfaces:**
- Consumes: `Temporal` from `@js-temporal/polyfill`.
- Produces: `type BudgetStatus = "ok" | "approaching" | "over"`; `interface BudgetProjection { spentSoFar: number; projectedMonthEnd: number; pctOfBudget: number; status: BudgetStatus }`; `projectMonthEnd(params: { spentSoFar: number; budget: number; threshold: number; now?: Temporal.ZonedDateTime }): BudgetProjection`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/projection.test.ts`:

```ts
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { projectMonthEnd } from "./projection";

// Day 10 of a 30-day month (June 2026), $50 spent => $5/day => $150 projected.
const now = Temporal.PlainDate.from("2026-06-10").toZonedDateTime("UTC");

describe("projectMonthEnd", () => {
  it("projects month-end spend from the daily run rate", () => {
    const p = projectMonthEnd({ spentSoFar: 50, budget: 200, threshold: 0.8, now });
    expect(p.projectedMonthEnd).toBeCloseTo(150, 6);
    expect(p.pctOfBudget).toBeCloseTo(0.75, 6);
    expect(p.status).toBe("ok");
  });
  it("flags approaching when projection crosses the threshold", () => {
    const p = projectMonthEnd({ spentSoFar: 50, budget: 180, threshold: 0.8, now });
    expect(p.status).toBe("approaching"); // 150 >= 0.8*180 (144), < 180
  });
  it("flags over when projection meets or exceeds budget", () => {
    const p = projectMonthEnd({ spentSoFar: 50, budget: 120, threshold: 0.8, now });
    expect(p.status).toBe("over"); // 150 >= 120
  });
  it("stays ok with no budget set", () => {
    const p = projectMonthEnd({ spentSoFar: 50, budget: 0, threshold: 0.8, now });
    expect(p.pctOfBudget).toBe(0);
    expect(p.status).toBe("ok");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/projection.test.ts`
Expected: FAIL — cannot resolve `./projection`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/projection.ts`:

```ts
import { Temporal } from "@js-temporal/polyfill";

export type BudgetStatus = "ok" | "approaching" | "over";

export interface BudgetProjection {
  spentSoFar: number;
  projectedMonthEnd: number;
  /** projectedMonthEnd / budget (0 when no budget). */
  pctOfBudget: number;
  status: BudgetStatus;
}

/**
 * Project end-of-month spend by extrapolating the spend-to-date run rate over
 * the full calendar month, then classify against the budget and threshold.
 */
export function projectMonthEnd(params: {
  spentSoFar: number;
  budget: number;
  threshold: number;
  now?: Temporal.ZonedDateTime;
}): BudgetProjection {
  const now = params.now ?? Temporal.Now.zonedDateTimeISO();
  const dayOfMonth = now.day;
  const daysInMonth = now.daysInMonth;

  const dailyRate = dayOfMonth > 0 ? params.spentSoFar / dayOfMonth : 0;
  const projectedMonthEnd = dailyRate * daysInMonth;
  const pctOfBudget =
    params.budget > 0 ? projectedMonthEnd / params.budget : 0;

  let status: BudgetStatus = "ok";
  if (params.budget > 0) {
    if (projectedMonthEnd >= params.budget) status = "over";
    else if (projectedMonthEnd >= params.threshold * params.budget)
      status = "approaching";
  }

  return {
    spentSoFar: params.spentSoFar,
    projectedMonthEnd,
    pctOfBudget,
    status,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/projection.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection.ts src/lib/projection.test.ts
git commit -m "feat: add projection module for month-end budget forecasting"
```

---

### Task 3: Settings persistence

**Files:**
- Modify: `src/lib/db.ts` (add `settings` table to the migration)
- Create: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `getDb`, `openMemoryDb` from `db.ts`; `Database.Database` type.
- Produces: `getBudget(db?): number | null`, `setBudget(value: number | null, db?): void`, `getThreshold(db?): number` (default `0.8`), `setThreshold(value: number, db?): void`. Constant `DEFAULT_THRESHOLD = 0.8`.

- [ ] **Step 1: Add the settings table**

In `src/lib/db.ts`, inside the `migrate` function's `database.exec(\`...\`)` block, add this table after the existing `CREATE INDEX ... idx_events_model` line (still inside the same template string):

```sql
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "./db";
import { getBudget, getThreshold, setBudget, setThreshold } from "./settings";

describe("settings", () => {
  it("returns null budget and default threshold when unset", () => {
    const db = openMemoryDb();
    expect(getBudget(db)).toBeNull();
    expect(getThreshold(db)).toBe(0.8);
  });
  it("round-trips a budget", () => {
    const db = openMemoryDb();
    setBudget(200, db);
    expect(getBudget(db)).toBe(200);
  });
  it("clears the budget when set to null", () => {
    const db = openMemoryDb();
    setBudget(200, db);
    setBudget(null, db);
    expect(getBudget(db)).toBeNull();
  });
  it("round-trips a threshold", () => {
    const db = openMemoryDb();
    setThreshold(0.5, db);
    expect(getThreshold(db)).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/lib/settings.test.ts`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/settings.ts`:

```ts
import type DatabaseType from "better-sqlite3";
import { getDb } from "./db";

export const DEFAULT_THRESHOLD = 0.8;
const BUDGET_KEY = "monthly_budget_usd";
const THRESHOLD_KEY = "budget_threshold";

function get(key: string, database: DatabaseType.Database): string | null {
  const row = database
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function set(key: string, value: string, database: DatabaseType.Database): void {
  database
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

function del(key: string, database: DatabaseType.Database): void {
  database.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function getBudget(database: DatabaseType.Database = getDb()): number | null {
  const raw = get(BUDGET_KEY, database);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setBudget(
  value: number | null,
  database: DatabaseType.Database = getDb(),
): void {
  if (value == null) del(BUDGET_KEY, database);
  else set(BUDGET_KEY, String(value), database);
}

export function getThreshold(database: DatabaseType.Database = getDb()): number {
  const raw = get(THRESHOLD_KEY, database);
  if (raw == null) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_THRESHOLD;
}

export function setThreshold(
  value: number,
  database: DatabaseType.Database = getDb(),
): void {
  set(THRESHOLD_KEY, String(value), database);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/settings.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/settings.ts src/lib/settings.test.ts
git commit -m "feat: persist budget and threshold in a local settings table"
```

---

### Task 4: Period-total and KPI-delta queries

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.deltas.test.ts`

**Interfaces:**
- Consumes: existing `COST` constant, `getDb`, `nowZoned` (private — already in file); `delta`, `Delta` from `deltas`.
- Produces:
  - `interface PeriodTotal { tokens: number; cost: number }`
  - `getTotalsBetween(startMs: number, endMs: number, db?): PeriodTotal`
  - `interface KpiDeltas { tokens: Delta; cost: Delta }`
  - `getKpiDeltas(now?: import("@js-temporal/polyfill").Temporal.ZonedDateTime, db?): KpiDeltas` — compares this-month-to-date vs. the same elapsed window of last month.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/queries.deltas.test.ts`:

```ts
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { insertEvents, openMemoryDb } from "./db";
import type { UsageEvent } from "./parse-claude-logs";
import { getKpiDeltas, getTotalsBetween } from "./queries";

function event(uuid: string, tsMs: number, input: number): UsageEvent {
  return {
    uuid,
    sessionId: "s",
    projectPath: "/p",
    projectId: "p",
    model: "claude-haiku-4-5-20251001", // $1/Mtok input => cost == input/1e6
    timestamp: new Date(tsMs).toISOString(),
    tsMs,
    inputTokens: input,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

describe("getTotalsBetween", () => {
  it("sums tokens and cost within [start, end)", () => {
    const db = openMemoryDb();
    insertEvents(
      [
        event("a", Date.UTC(2026, 5, 2), 1_000_000),
        event("b", Date.UTC(2026, 5, 20), 1_000_000), // outside the window below
      ],
      db,
    );
    const total = getTotalsBetween(Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 10), db);
    expect(total.tokens).toBe(1_000_000);
    expect(total.cost).toBeCloseTo(1, 6);
  });
});

describe("getKpiDeltas", () => {
  it("compares this month-to-date against last month's same window", () => {
    const db = openMemoryDb();
    // now = June 10 (UTC). This-month window: Jun 1 .. Jun 10.
    // Last-month same window: May 1 .. May 10.
    insertEvents(
      [
        event("cur", Date.UTC(2026, 5, 5), 2_000_000), // June -> current
        event("prev", Date.UTC(2026, 4, 5), 1_000_000), // May -> previous
      ],
      db,
    );
    const now = Temporal.PlainDate.from("2026-06-10").toZonedDateTime("UTC");
    const d = getKpiDeltas(now, db);
    expect(d.tokens.direction).toBe("up");
    expect(d.tokens.pct).toBeCloseTo(1, 6); // 2M vs 1M => +100%
    expect(d.cost.pct).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/queries.deltas.test.ts`
Expected: FAIL — `getTotalsBetween` / `getKpiDeltas` not exported.

- [ ] **Step 3: Add the queries**

In `src/lib/queries.ts`, add to the imports:

```ts
import type DatabaseType from "better-sqlite3";
import { delta, type Delta } from "./deltas";
```

(If `import type DatabaseType from "better-sqlite3";` was already added in Phase 1, do not duplicate it.)

Add at the end of the file, before `export { timeZone };`:

```ts
export interface PeriodTotal {
  tokens: number;
  cost: number;
}

/** Token and estimated-cost totals for the half-open window [startMs, endMs). */
export function getTotalsBetween(
  startMs: number,
  endMs: number,
  database: DatabaseType.Database = getDb(),
): PeriodTotal {
  return database
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(${COST}), 0) AS cost
       FROM events
       WHERE ts_ms >= ? AND ts_ms < ?`,
    )
    .get(startMs, endMs) as PeriodTotal;
}

export interface KpiDeltas {
  tokens: Delta;
  cost: Delta;
}

/**
 * This-month-to-date vs. the same elapsed window of last month, for token and
 * cost deltas on the KPI cards.
 */
export function getKpiDeltas(
  now = nowZoned(),
  database: DatabaseType.Database = getDb(),
): KpiDeltas {
  const thisStart = now.with({ day: 1 }).startOfDay();
  const lastStart = thisStart.subtract({ months: 1 });
  const elapsedMs = now.epochMilliseconds - thisStart.epochMilliseconds;

  const current = getTotalsBetween(
    thisStart.epochMilliseconds,
    now.epochMilliseconds,
    database,
  );
  const previous = getTotalsBetween(
    lastStart.epochMilliseconds,
    lastStart.epochMilliseconds + elapsedMs,
    database,
  );

  return {
    tokens: delta(current.tokens, previous.tokens),
    cost: delta(current.cost, previous.cost),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/queries.deltas.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.deltas.test.ts
git commit -m "feat: add period-total and KPI delta queries"
```

---

### Task 5: Settings API route + budget form

**Files:**
- Create: `src/app/api/settings/route.ts`
- Create: `src/components/budget-form.tsx`

**Interfaces:**
- Consumes: `getBudget`, `setBudget`, `getThreshold`, `setThreshold` from `settings`.
- Produces: `GET /api/settings` → `{ budget: number | null; threshold: number }`; `POST /api/settings` body `{ budget?: number | null; threshold?: number }` → updated `{ budget, threshold }`. A `BudgetForm` client component.

UI/route task — verified by typecheck + manual interaction (cost math already tested in Tasks 1–4).

- [ ] **Step 1: Create the API route**

Create `src/app/api/settings/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { getBudget, getThreshold, setBudget, setThreshold } from "@/lib/settings";

// Reads/writes local SQLite — must run on Node, never the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ budget: getBudget(), threshold: getThreshold() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      budget?: number | null;
      threshold?: number;
    };

    if ("budget" in body) {
      if (body.budget != null && (!Number.isFinite(body.budget) || body.budget < 0)) {
        return NextResponse.json({ error: "Invalid budget" }, { status: 400 });
      }
      setBudget(body.budget ?? null);
    }
    if (body.threshold != null) {
      if (!Number.isFinite(body.threshold) || body.threshold <= 0 || body.threshold > 1) {
        return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
      }
      setThreshold(body.threshold);
    }

    return NextResponse.json({ budget: getBudget(), threshold: getThreshold() });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the budget form**

Create `src/components/budget-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Sets the local monthly budget; refreshes server data on save. */
export function BudgetForm({ budget }: { budget: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(budget != null ? String(budget) : "");
  const [isPending, startTransition] = useTransition();

  const onSave = async () => {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      toast.error("Enter a non-negative number, or clear to remove the budget.");
      return;
    }
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget: parsed }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success(parsed == null ? "Budget cleared." : "Budget saved.");
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        step={1}
        placeholder="Monthly budget (USD)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-48"
      />
      <Button size="sm" onClick={onSave} disabled={isPending}>
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/route.ts src/components/budget-form.tsx
git commit -m "feat: add settings API and budget form"
```

---

### Task 6: Budget card + KPI delta badges on Overview

**Files:**
- Modify: `src/components/kpi-card.tsx` (optional delta badge)
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `projectMonthEnd` (projection), `getBudget`/`getThreshold` (settings), `getCostInsightThisMonth` (Phase 1), `getKpiDeltas` (Task 4), `BudgetForm` (Task 5), `Delta`/`Direction` (deltas).
- Produces: a budget card and delta badges. Nothing consumed downstream.

UI task — verified by typecheck + visual inspection.

- [ ] **Step 1: Add an optional delta badge to KpiCard**

In `src/components/kpi-card.tsx`, extend the props and render a small change indicator. Replace the component with:

```tsx
import { ArrowDown, ArrowUp, type LucideIcon, Minus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Direction } from "@/lib/deltas";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  delta?: { direction: Direction; label: string };
}) {
  const DeltaIcon =
    delta?.direction === "up"
      ? ArrowUp
      : delta?.direction === "down"
        ? ArrowDown
        : Minus;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {delta ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <DeltaIcon className="size-3" />
            {delta.label}
          </span>
        ) : null}
      </CardHeader>
      {hint ? (
        <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Wire budget + deltas into the Overview page**

In `src/app/(dashboard)/page.tsx`:

Add imports:

```ts
import { BudgetForm } from "@/components/budget-form";
import { getBudget, getThreshold } from "@/lib/settings";
import { projectMonthEnd } from "@/lib/projection";
import {
  getCostInsightThisMonth,
  getDailyTokens,
  getKpiDeltas,
  getModelTotals,
  getOverviewKpis,
} from "@/lib/queries";
```

In the component body, after the existing KPI/insight queries, add:

```ts
  const deltas = getKpiDeltas();
  const budget = getBudget();
  const threshold = getThreshold();
  const projection = projectMonthEnd({
    spentSoFar: kpis.estimatedCostThisMonth,
    budget: budget ?? 0,
    threshold,
  });
```

Add `delta` props to the two month KPI cards. For "Tokens this month":

```tsx
          delta={{
            direction: deltas.tokens.direction,
            label:
              deltas.tokens.pct == null
                ? "vs last month"
                : `${(deltas.tokens.pct * 100).toFixed(0)}% vs last month`,
          }}
```

and the analogous `delta={{ direction: deltas.cost.direction, label: ... }}` on "Est. cost this month".

Add a budget card. Insert it after the KPI grid `</div>` and before the "Cost insights" card from Phase 1:

```tsx
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Monthly budget</CardTitle>
            <CardDescription>
              {budget == null
                ? "Set a budget to track your run rate. Estimates from list prices, not actual billing."
                : `Projected month-end: ${budget > 0 ? Math.round(projection.pctOfBudget * 100) : 0}% of budget · status: ${projection.status}. Estimates, not actual billing.`}
            </CardDescription>
          </div>
          <BudgetForm budget={budget} />
        </CardHeader>
        {budget != null ? (
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Spent so far</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatCurrency(projection.spentSoFar)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Projected month-end
              </span>
              <span className="text-xl font-semibold tabular-nums">
                {formatCurrency(projection.projectedMonthEnd)}
              </span>
            </div>
          </CardContent>
        ) : null}
      </Card>
```

`formatCurrency` and `Card*` are already imported in this file from Phase 1.

- [ ] **Step 3: Verify typecheck and render**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, open http://localhost:3000. With no budget: budget card shows the "set a budget" prompt and the two month KPI cards show delta lines. Set a budget via the form, confirm it persists after a refresh and the projection + status render. Stop the dev server.

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/kpi-card.tsx "src/app/(dashboard)/page.tsx"
git commit -m "feat: budget projection card and KPI delta badges on overview"
```

---

## Self-Review

- **Spec coverage (stories 8–15):** set monthly budget (8) → Tasks 3, 5; projected end-of-month (9) → Tasks 2, 6; visual status ok/approaching/over (10) → Tasks 2, 6; configurable threshold (11) → Tasks 3, 5 (API accepts threshold; default 0.8); WoW/MoM deltas on KPIs (12) → Tasks 1, 4, 6 (month-over-month implemented; week-over-week uses the same `getTotalsBetween` primitive and can be added identically if desired — noted, not built, to keep the card uncluttered); budget persists across restarts (13) → Task 3 (SQLite); projection accounts for elapsed vs remaining days (14) → Task 2 (`dayOfMonth`/`daysInMonth`); opt-in, dashboard works with no budget (15) → Task 6 (budget UI gated on `budget != null`).
- **Placeholder scan:** every code step shows full code; commands include expected output. The "week-over-week" note is an explicit scope decision, not a placeholder.
- **Type consistency:** `Delta`/`Direction` from `deltas` used identically in Tasks 1, 4, 6; `BudgetProjection`/`BudgetStatus` from `projection` consistent in Tasks 2, 6; settings function signatures (`getBudget`/`setBudget(value|null)`/`getThreshold`/`setThreshold`) identical across Tasks 3, 5, 6; `getKpiDeltas(now?, db?)` / `getTotalsBetween(start, end, db?)` signatures match between Task 4 definition and Task 6 use.
