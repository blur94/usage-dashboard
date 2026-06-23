# Cost Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the dashboard's already-computed-but-unused cost intelligence — prompt-cache savings, the "one model tier down" counterfactual, per-project saving opportunities, and a recommendation — on the Overview and Projects pages.

**Architecture:** Add one pure deep module (`cost-insights`) that wraps the existing `pricing` functions (`costFor`, `cacheSavingsFor`, `nextTierDown`, `tierForModel`) into a single cost-math interface. The query layer groups token totals by model in SQL and feeds them through that module, so every dollar figure in the app derives from one source of truth. The Overview and Projects server components render the results. No new external services; everything stays local.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · better-sqlite3 · Recharts · shadcn/ui · `@js-temporal/polyfill` for dates · Vitest (added in Task 1) for unit tests.

## Global Constraints

- Next.js 16 — APIs differ from older versions; consult `node_modules/next/dist/docs/` before writing any Next-specific code. (per AGENTS.md)
- All cost figures are **estimates from list prices, not actual billing** — every cost surface must keep that labeling.
- All date/calendar math uses `@js-temporal/polyfill` (`Temporal`), never the native `Date`.
- URL-persisted filters use `nuqs` (existing convention) — not relevant to this phase but do not regress it.
- TypeScript is `strict`; no `any`, no non-null assertions on possibly-undefined query rows.
- Re-running sync must stay idempotent; do not change the `events` schema or the `uuid` primary-key contract in this phase.
- Tests are colocated next to source as `*.test.ts` and use **relative** imports (no `@/` alias in tests).

---

### Task 1: Vitest test harness

**Files:**
- Modify: `package.json` (add `vitest` dev dependency + `test` scripts)
- Create: `vitest.config.ts`
- Create: `src/lib/format.test.ts` (smoke test against existing pure code)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm test` command that discovers `src/**/*.test.ts`. Later tasks rely on this.

- [ ] **Step 1: Install Vitest**

Run:

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Add test scripts to package.json**

In `package.json`, add these two entries to the `"scripts"` object (alongside the existing `typecheck` entry):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the smoke test**

Create `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatPercent } from "./format";

describe("formatPercent", () => {
  it("renders a 0–1 ratio as a one-decimal percentage", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
  });
});
```

- [ ] **Step 5: Run the test to verify the harness works**

Run: `pnpm test`
Expected: PASS — 1 test passed in `src/lib/format.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/format.test.ts
git commit -m "test: add vitest harness with smoke test"
```

---

### Task 2: `cost-insights` pure module

**Files:**
- Create: `src/lib/cost-insights.ts`
- Test: `src/lib/cost-insights.test.ts`

**Interfaces:**
- Consumes from `src/lib/pricing.ts` (existing, unchanged): `type TokenBreakdown` (`{ input, output, cacheCreation, cacheRead }`), `costFor(tokens, tier)`, `cacheSavingsFor(cacheReadTokens, tier)`, `nextTierDown(model)`, `tierForModel(model)`. Each `ModelTier` has a `.label` string.
- Produces (later tasks rely on these exact names/types):
  - `interface CostInsight { actualCost: number; costOneTierDown: number | null; oneTierDownLabel: string | null; potentialSavings: number; cacheSavings: number; recommendation: string | null }`
  - `interface ScopeCostInsight { actualCost: number; potentialSavings: number; cacheSavings: number }`
  - `costInsightFor(tokens: TokenBreakdown, model: string): CostInsight`
  - `aggregateInsights(entries: { tokens: TokenBreakdown; model: string }[]): ScopeCostInsight`
  - `const RECOMMEND_SAVINGS_THRESHOLD: number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cost-insights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TokenBreakdown } from "./pricing";
import {
  aggregateInsights,
  costInsightFor,
} from "./cost-insights";

const oneMillion = 1_000_000;

// 1M input + 1M output + 1M cache-read on Opus (in $5/Mtok, out $25/Mtok).
const opusTokens: TokenBreakdown = {
  input: oneMillion,
  output: oneMillion,
  cacheCreation: 0,
  cacheRead: oneMillion,
};

describe("costInsightFor", () => {
  it("computes actual cost, cache savings, tier-down cost and a recommendation for a known model", () => {
    const insight = costInsightFor(opusTokens, "claude-opus-4-8");

    // 5 (input) + 25 (output) + 0.5 (cache reads @ 0.1x input) = 30.5
    expect(insight.actualCost).toBeCloseTo(30.5, 6);
    // cache reads would have cost 5 as fresh input; saved 90% => 4.5
    expect(insight.cacheSavings).toBeCloseTo(4.5, 6);
    // Sonnet (in $3, out $15): 3 + 15 + 0.3 = 18.3
    expect(insight.costOneTierDown).toBeCloseTo(18.3, 6);
    expect(insight.oneTierDownLabel).toBe("Sonnet 4.6");
    expect(insight.potentialSavings).toBeCloseTo(12.2, 6);
    expect(insight.recommendation).toContain("Sonnet 4.6");
    expect(insight.recommendation).toContain("40%");
  });

  it("offers no tier-down for the cheapest tier", () => {
    const insight = costInsightFor(
      { input: oneMillion, output: 0, cacheCreation: 0, cacheRead: 0 },
      "claude-haiku-4-5-20251001",
    );
    expect(insight.actualCost).toBeCloseTo(1, 6); // 1M input @ $1/Mtok
    expect(insight.costOneTierDown).toBeNull();
    expect(insight.potentialSavings).toBe(0);
    expect(insight.recommendation).toBeNull();
  });

  it("returns zeros for an unknown model", () => {
    const insight = costInsightFor(opusTokens, "gpt-4");
    expect(insight.actualCost).toBe(0);
    expect(insight.cacheSavings).toBe(0);
    expect(insight.costOneTierDown).toBeNull();
    expect(insight.recommendation).toBeNull();
  });
});

describe("aggregateInsights", () => {
  it("sums actual cost, potential savings and cache savings across entries", () => {
    const agg = aggregateInsights([
      { tokens: opusTokens, model: "claude-opus-4-8" },
      {
        tokens: { input: oneMillion, output: 0, cacheCreation: 0, cacheRead: 0 },
        model: "claude-haiku-4-5-20251001",
      },
    ]);
    expect(agg.actualCost).toBeCloseTo(31.5, 6); // 30.5 + 1
    expect(agg.potentialSavings).toBeCloseTo(12.2, 6); // opus only
    expect(agg.cacheSavings).toBeCloseTo(4.5, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/cost-insights.test.ts`
Expected: FAIL — cannot resolve `./cost-insights` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/cost-insights.ts`:

```ts
import {
  type TokenBreakdown,
  cacheSavingsFor,
  costFor,
  nextTierDown,
  tierForModel,
} from "./pricing";

/** Fraction of actual cost that must be saved before we recommend a downgrade. */
export const RECOMMEND_SAVINGS_THRESHOLD = 0.2;

export interface CostInsight {
  /** Estimated USD cost at the model's own tier. */
  actualCost: number;
  /** Estimated USD cost if the same tokens ran one tier down, or null. */
  costOneTierDown: number | null;
  /** Display label of the next-cheaper tier, or null. */
  oneTierDownLabel: string | null;
  /** actualCost − costOneTierDown, floored at 0 (0 when no cheaper tier). */
  potentialSavings: number;
  /** USD saved by reading from cache instead of paying fresh input. */
  cacheSavings: number;
  /** Human guidance, or null when there's nothing worth recommending. */
  recommendation: string | null;
}

export interface ScopeCostInsight {
  actualCost: number;
  potentialSavings: number;
  cacheSavings: number;
}

/** Cost intelligence for one token breakdown billed at one model's rates. */
export function costInsightFor(
  tokens: TokenBreakdown,
  model: string,
): CostInsight {
  const tier = tierForModel(model);
  if (!tier) {
    return {
      actualCost: 0,
      costOneTierDown: null,
      oneTierDownLabel: null,
      potentialSavings: 0,
      cacheSavings: 0,
      recommendation: null,
    };
  }

  const actualCost = costFor(tokens, tier);
  const cacheSavings = cacheSavingsFor(tokens.cacheRead, tier);

  const lower = nextTierDown(model);
  if (!lower) {
    return {
      actualCost,
      costOneTierDown: null,
      oneTierDownLabel: null,
      potentialSavings: 0,
      cacheSavings,
      recommendation: null,
    };
  }

  const costOneTierDown = costFor(tokens, lower);
  const potentialSavings = Math.max(0, actualCost - costOneTierDown);
  const fraction = actualCost > 0 ? potentialSavings / actualCost : 0;
  const recommendation =
    fraction >= RECOMMEND_SAVINGS_THRESHOLD
      ? `Could run on ${lower.label} for ~${Math.round(fraction * 100)}% less.`
      : null;

  return {
    actualCost,
    costOneTierDown,
    oneTierDownLabel: lower.label,
    potentialSavings,
    cacheSavings,
    recommendation,
  };
}

/** Sum the cost insight across many (tokens, model) entries. */
export function aggregateInsights(
  entries: { tokens: TokenBreakdown; model: string }[],
): ScopeCostInsight {
  return entries.reduce<ScopeCostInsight>(
    (acc, { tokens, model }) => {
      const insight = costInsightFor(tokens, model);
      acc.actualCost += insight.actualCost;
      acc.potentialSavings += insight.potentialSavings;
      acc.cacheSavings += insight.cacheSavings;
      return acc;
    },
    { actualCost: 0, potentialSavings: 0, cacheSavings: 0 },
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/cost-insights.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost-insights.ts src/lib/cost-insights.test.ts
git commit -m "feat: add cost-insights module for savings and tier-down counterfactuals"
```

---

### Task 3: Cost-insight queries + injectable DB

**Files:**
- Modify: `src/lib/db.ts` (add `openMemoryDb()`; let `insertEvents` accept a db)
- Modify: `src/lib/queries.ts` (add `getCostInsight`, `getCostInsightThisMonth`, `getProjectInsights`)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `aggregateInsights`, `ScopeCostInsight` from Task 2; `TokenBreakdown` from `pricing`; existing `getDb()`, `insertEvents()`, `migrate()` (private), `projectShortName()`.
- Produces (Task 4 & 5 rely on these):
  - `openMemoryDb(): Database.Database` (in `db.ts`) — fresh in-memory DB with schema applied.
  - `insertEvents(events: UsageEvent[], database?: Database.Database): number` — defaults to `getDb()`.
  - `getCostInsight(sinceMs?: number, database?: Database.Database): ScopeCostInsight`
  - `getCostInsightThisMonth(database?: Database.Database): ScopeCostInsight`
  - `interface ProjectInsightRow { projectId: string; shortName: string; actualCost: number; potentialSavings: number; cacheSavings: number }`
  - `getProjectInsights(database?: Database.Database): ProjectInsightRow[]` — sorted by `potentialSavings` desc.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/queries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertEvents, openMemoryDb } from "./db";
import type { UsageEvent } from "./parse-claude-logs";
import { getCostInsight, getProjectInsights } from "./queries";

const oneMillion = 1_000_000;

function event(partial: Partial<UsageEvent>): UsageEvent {
  return {
    uuid: partial.uuid ?? crypto.randomUUID(),
    sessionId: partial.sessionId ?? "s1",
    projectPath: partial.projectPath ?? "/home/me/proj",
    projectId: partial.projectId ?? "proj1",
    model: partial.model ?? "claude-opus-4-8",
    timestamp: partial.timestamp ?? "2026-06-01T00:00:00Z",
    tsMs: partial.tsMs ?? Date.UTC(2026, 5, 1),
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    cacheCreationInputTokens: partial.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: partial.cacheReadInputTokens ?? 0,
  };
}

describe("getCostInsight", () => {
  it("aggregates cost intelligence across models", () => {
    const db = openMemoryDb();
    insertEvents(
      [
        event({
          uuid: "a",
          model: "claude-opus-4-8",
          inputTokens: oneMillion,
          outputTokens: oneMillion,
          cacheReadInputTokens: oneMillion,
        }),
        event({
          uuid: "b",
          model: "claude-haiku-4-5-20251001",
          inputTokens: oneMillion,
        }),
      ],
      db,
    );

    const insight = getCostInsight(undefined, db);
    expect(insight.actualCost).toBeCloseTo(31.5, 6); // 30.5 + 1
    expect(insight.potentialSavings).toBeCloseTo(12.2, 6); // opus only
    expect(insight.cacheSavings).toBeCloseTo(4.5, 6);
  });
});

describe("getProjectInsights", () => {
  it("returns one row per project, sorted by potential savings", () => {
    const db = openMemoryDb();
    insertEvents(
      [
        event({
          uuid: "a",
          projectId: "p1",
          projectPath: "/home/me/big",
          model: "claude-opus-4-8",
          inputTokens: oneMillion,
          outputTokens: oneMillion,
          cacheReadInputTokens: oneMillion,
        }),
        event({
          uuid: "b",
          projectId: "p2",
          projectPath: "/home/me/small",
          model: "claude-haiku-4-5-20251001",
          inputTokens: oneMillion,
        }),
      ],
      db,
    );

    const rows = getProjectInsights(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].projectId).toBe("p1"); // bigger potential savings first
    expect(rows[0].shortName).toBe("me/big");
    expect(rows[0].potentialSavings).toBeCloseTo(12.2, 6);
    expect(rows[1].potentialSavings).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/queries.test.ts`
Expected: FAIL — `openMemoryDb` is not exported / `getCostInsight` is not exported.

- [ ] **Step 3: Add `openMemoryDb` and injectable `insertEvents` in db.ts**

In `src/lib/db.ts`, add this export after the `getDb` function (it reuses the existing private `migrate`):

```ts
/** A fresh in-memory database with the schema applied. For tests. */
export function openMemoryDb(): Database.Database {
  const memory = new Database(":memory:");
  migrate(memory);
  return memory;
}
```

Then change the `insertEvents` signature so it can target a supplied database (defaulting to the shared one). Replace the first line of the function body:

```ts
export function insertEvents(
  events: UsageEvent[],
  database: Database.Database = getDb(),
): number {
```

and delete the now-redundant `const database = getDb();` line that was inside the old body. The rest of the function is unchanged.

- [ ] **Step 4: Add the cost-insight queries in queries.ts**

In `src/lib/queries.ts`, add these imports at the top (next to the existing imports):

```ts
import type DatabaseType from "better-sqlite3";
import type { TokenBreakdown } from "./pricing";
import { aggregateInsights, type ScopeCostInsight } from "./cost-insights";
```

Add this private helper and the three query functions at the end of the file (before the final `export { timeZone };` line):

```ts
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
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output,
              SUM(cache_creation_input_tokens) AS cacheCreation,
              SUM(cache_read_input_tokens) AS cacheRead
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
}

/** Per-project cost insight, sorted by potential savings (largest first). */
export function getProjectInsights(
  database: DatabaseType.Database = getDb(),
): ProjectInsightRow[] {
  const rows = database
    .prepare(
      `SELECT project_id AS projectId, project_path AS projectPath, model,
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output,
              SUM(cache_creation_input_tokens) AS cacheCreation,
              SUM(cache_read_input_tokens) AS cacheRead
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
    });
  }
  out.sort((a, b) => b.potentialSavings - a.potentialSavings);
  return out;
}
```

Note: `startOfMonthMs` and `projectShortName` already exist in this file — reuse them, do not redefine.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/queries.test.ts`
Expected: PASS — both describe blocks pass.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass; `tsc --noEmit` reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db.ts src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add cost-insight queries with injectable db for testing"
```

---

### Task 4: Cost Insights card on Overview

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `getCostInsightThisMonth()` from Task 3; `formatCurrency` from `src/lib/format.ts`; existing `Card*` components.
- Produces: a rendered "Cost insights" card. No code consumed by later tasks.

This is a UI task; it is verified by typecheck + visual inspection rather than a unit test (the cost math it shows is already covered by Tasks 2–3).

- [ ] **Step 1: Import the query**

In `src/app/(dashboard)/page.tsx`, add `getCostInsightThisMonth` to the existing import from `@/lib/queries`:

```ts
import {
  getCostInsightThisMonth,
  getDailyTokens,
  getModelTotals,
  getOverviewKpis,
} from "@/lib/queries";
```

- [ ] **Step 2: Call the query in the component body**

Below the existing `const kpis = getOverviewKpis();` line, add:

```ts
  const insight = getCostInsightThisMonth();
```

- [ ] **Step 3: Render the card**

Immediately after the closing `</div>` of the KPI grid (the `<div className="grid ...">` block) and before the existing "Daily token usage" `<Card>`, insert:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Cost insights</CardTitle>
          <CardDescription>
            This month · estimates from list prices, not actual billing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Saved by prompt caching
            </span>
            <span className="text-xl font-semibold tabular-nums">
              {formatCurrency(insight.cacheSavings)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Potential savings one tier down
            </span>
            <span className="text-xl font-semibold tabular-nums">
              {formatCurrency(insight.potentialSavings)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Recommendation</span>
            <span className="text-sm">
              {insight.potentialSavings > 0
                ? `Moving cheaper-tier-eligible work down a tier could save about ${formatCurrency(insight.potentialSavings)} this month.`
                : "You're already on the most cost-effective tiers."}
            </span>
          </div>
        </CardContent>
      </Card>
```

`formatCurrency` and the `Card*` components are already imported in this file — no new component imports needed.

- [ ] **Step 4: Verify it typechecks and renders**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, open http://localhost:3000, confirm a "Cost insights" card appears between the KPI row and the daily chart, showing three figures, with the "estimates" labeling present. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/page.tsx"
git commit -m "feat: show cost insights card on overview"
```

---

### Task 5: Top saving opportunities on Projects

**Files:**
- Create: `src/components/saving-opportunities.tsx`
- Modify: `src/app/(dashboard)/projects/page.tsx`

**Interfaces:**
- Consumes: `getProjectInsights()` and `ProjectInsightRow` from Task 3; `formatCurrency` from format; existing `Card*` components.
- Produces: a `SavingOpportunities` component rendered above the projects table.

UI task — verified by typecheck + visual inspection.

- [ ] **Step 1: Create the component**

Create `src/components/saving-opportunities.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { ProjectInsightRow } from "@/lib/queries";

/** Top projects by estimated potential savings from a one-tier-down switch. */
export function SavingOpportunities({ data }: { data: ProjectInsightRow[] }) {
  const top = data.filter((p) => p.potentialSavings > 0).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top saving opportunities</CardTitle>
        <CardDescription>
          Estimated savings if eligible work ran one model tier down. Estimates
          from list prices, not actual billing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tier-down savings available — every project is already on a
            cost-effective tier.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((p) => (
              <li
                key={p.projectId}
                className="flex items-center justify-between gap-4"
              >
                <span className="font-medium">{p.shortName}</span>
                <span className="tabular-nums text-muted-foreground">
                  save up to {formatCurrency(p.potentialSavings)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into the Projects page**

In `src/app/(dashboard)/projects/page.tsx`:

Add imports:

```ts
import { SavingOpportunities } from "@/components/saving-opportunities";
import { getProjectInsights, getProjects } from "@/lib/queries";
```

(replace the existing single `getProjects` import line).

In the component body, below `const projects = getProjects();`, add:

```ts
  const insights = getProjectInsights();
```

Wrap the returned JSX so the new card sits above the existing projects `<Card>`. Change the top-level return to:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <SavingOpportunities data={insights} />
      <Card>
        {/* ...existing projects card unchanged... */}
      </Card>
    </div>
  );
```

Keep the existing `<Card>...</Card>` block (header + `ProjectsTable`) exactly as it was, now nested inside the new wrapping `<div>`.

- [ ] **Step 3: Verify it typechecks and renders**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev`, open http://localhost:3000/projects, confirm a "Top saving opportunities" card renders above the projects table (or its empty-state message when there are no savings). Stop the dev server.

- [ ] **Step 4: Run the full suite once more**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/saving-opportunities.tsx "src/app/(dashboard)/projects/page.tsx"
git commit -m "feat: show top saving opportunities on projects page"
```

---

## Subsequent phases (separate plans)

This plan covers **Phase 1: Cost Intelligence** only (PRD user stories 1–7). The remaining PRD subsystems are independent and each warrants its own plan, building on the `cost-insights` module delivered here:

- **Phase 2 — Budgets, alerts & projections** (stories 8–15): new pure `projection`/`budget` module, a local `settings` table, KPI delta badges.
- **Phase 3 — Reporting & exploration UX** (stories 24–31): app-level `nuqs` filters, activity heatmap, single-session timeline, CSV/JSON export.
- **Phase 4 — Deeper log mining** (stories 16–23): additive parser + schema extension for tool calls, session duration, and turn timing.

---

## Self-Review

- **Spec coverage (Phase 1, stories 1–7):** cache savings in dollars (story 1, 5) → Task 4 card; one-tier-down counterfactual (story 2) → Tasks 2–4; biggest cost drivers (story 3) → Task 5; per-project recommendation (story 4) → Tasks 2 (`recommendation`) & 5; estimates clearly labeled (story 6) → Tasks 4 & 5 copy. Story 7 (effective cost-per-output-token by model) is **not** implemented here — it belongs to the Models page and is deferred; noted so it isn't lost. All other Phase-1 stories are covered.
- **Placeholder scan:** every code step shows complete code; no TBD/TODO/"handle edge cases"; commands have expected output.
- **Type consistency:** `CostInsight`/`ScopeCostInsight`/`ProjectInsightRow` field names match across Tasks 2→3→4→5; `getCostInsight(sinceMs?, db?)`, `getCostInsightThisMonth(db?)`, `getProjectInsights(db?)`, `insertEvents(events, db?)`, `openMemoryDb()` signatures are used identically where consumed; `TokenBreakdown` fields (`input/output/cacheCreation/cacheRead`) match `pricing.ts`.
