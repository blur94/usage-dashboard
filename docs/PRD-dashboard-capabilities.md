# PRD: Claude Code Usage Dashboard — Capability Expansion

> Status: Draft · Owner: @blur94 · Type: Roadmap PRD (multi-feature)
> Scope: Cost intelligence · Budgets/alerts/projections · Deeper log mining · Reporting & exploration UX

## Problem Statement

I run Claude Code across many projects every day, and the only honest record of
what that costs me — in tokens, dollars, and time — is buried in thousands of
`.jsonl` session logs. The current dashboard answers "how many tokens did I burn
this month and on which projects," but it stops there. As a user I still can't
answer the questions I actually care about:

- **"Am I overspending, and on what?"** The dashboard estimates cost but never
  tells me where the money goes, whether I could have used a cheaper model, or
  how much prompt caching is actually saving me. The numbers to answer this are
  already computed in the code but never shown to me.
- **"Will I blow my budget this month?"** There is no budget, no run-rate
  projection, and no warning. I find out I overspent only after the fact.
- **"What am I actually doing in these sessions?"** The parser throws away
  everything except token counts. I can't see which tools I lean on, how long
  sessions run, or which single sessions were unusually expensive.
- **"Can I slice the data the way I think?"** Filters only exist on the Overview
  page, there's no time-of-day view, no per-session timeline, and no way to
  export anything for my own analysis.

The result is a dashboard that reports the past but gives me no leverage to
change my behavior or control my spend.

## Solution

Extend the existing local-first dashboard along four fronts, reusing the current
ingestion → SQLite → query → UI pipeline rather than replacing it:

1. **Cost intelligence & savings.** Surface the cost insights the codebase
   already computes: how much prompt caching saved me, what each scope would
   have cost one model-tier down ("you'd have spent ~$X less on Sonnet"), and a
   ranked list of my biggest cost drivers. Add per-project model-migration
   recommendations driven by the existing tier model.

2. **Budgets, alerts & projections.** Let me set a monthly USD budget, see a
   run-rate projection to month-end, get a clear visual warning as I approach or
   exceed it, and see week-over-week / month-over-month deltas on every KPI so I
   know if I'm trending up or down.

3. **Deeper log mining.** Extend the parser to capture what it currently
   discards — tool calls, turn-level latency, and session start/end — so the
   dashboard can show tool-usage analytics, session durations, and per-session
   timelines. This is additive and idempotent like today's parse.

4. **Reporting & exploration UX.** Make filters (date range, model, project)
   global across all pages, add a time-of-day / day-of-week activity heatmap, a
   single-session timeline view, and CSV/JSON export of any current view.

Everything stays local, private, and offline. No new external services.

## User Stories

### Cost intelligence & savings

1. As a Claude Code user, I want to see how many dollars prompt caching saved me
   over a period, so that I understand the value of cache-friendly prompting.
2. As a cost-conscious user, I want each scope (overview, project, session) to
   show what it *would* have cost one model tier down, so that I can judge
   whether I'm over-provisioning model power.
3. As a user, I want a ranked "biggest cost drivers" list (by project, by model,
   by session), so that I can target the few things that dominate my spend.
4. As a user, I want a per-project recommendation like "most of this project's
   turns could run on Sonnet for ~40% less," so that I get actionable guidance,
   not just numbers.
5. As a user, I want the cache hit rate shown alongside its dollar value, so
   that a percentage becomes a meaningful savings figure.
6. As a user, I want cost figures to clearly remain labeled as estimates from
   list prices, so that I don't mistake them for actual billing.
7. As a user comparing models, I want to see effective cost-per-output-token by
   model, so that I can reason about value, not just totals.

### Budgets, alerts & projections

8. As a user, I want to set a monthly USD budget, so that I have a target to
   measure spend against.
9. As a user, I want to see my projected end-of-month spend based on the current
   run rate, so that I can course-correct mid-month.
10. As a user, I want a clear visual state (ok / approaching / over) on the
    budget, so that I notice problems at a glance.
11. As a user, I want a configurable warning threshold (e.g. 80% of budget), so
    that the alert fires when *I* consider it urgent.
12. As a user, I want week-over-week and month-over-month deltas on each KPI
    card, so that I can tell whether my usage is trending up or down.
13. As a user, I want my budget setting to persist locally across restarts, so
    that I set it once.
14. As a user, I want the projection to account for elapsed vs. remaining days in
    the month, so that early-month numbers aren't misleadingly extrapolated.
15. As a user with no budget set, I want the dashboard to still work and simply
    omit budget UI, so that the feature is opt-in.

### Deeper log mining

16. As a user, I want to see which tools I use most (Read, Edit, Bash, etc.)
    across all sessions, so that I understand my own working patterns.
17. As a user, I want tool usage broken down per project, so that I can see how
    my workflow differs between codebases.
18. As a user, I want to see how long my sessions last (wall-clock), so that I
    can correlate effort with cost.
19. As a user, I want per-turn latency stats where the logs allow it, so that I
    can spot slow turns.
20. As a user, I want session turn counts and average tokens-per-turn, so that I
    can see whether sessions are sprawling.
21. As a user, I want the deeper parse to be idempotent and re-runnable like the
    current sync, so that re-syncing never double-counts.
22. As a user, I want the new parsing to degrade gracefully when a log lacks the
    richer fields, so that older or partial logs still import.
23. As a user, I want the existing token/cost data to be unaffected by the new
    parsing, so that the upgrade is safe.

### Reporting & exploration UX

24. As a user, I want date-range, model, and project filters to apply on every
    page, so that I can keep one mental context as I navigate.
25. As a user, I want my filter selections to persist in the URL, so that I can
    bookmark and share a specific view (consistent with today's `nuqs` usage).
26. As a user, I want a time-of-day / day-of-week heatmap of my activity, so
    that I can see when I work most intensely.
27. As a user, I want to open a single session and see its turns on a timeline
    with tokens and cost, so that I can understand an expensive session.
28. As a user, I want to export the current view as CSV, so that I can do my own
    analysis in a spreadsheet.
29. As a user, I want to export the current view as JSON, so that I can script
    against it.
30. As a user, I want exports to respect the active filters, so that I export
    exactly what I'm looking at.
31. As a user, I want empty states on every new view when there's no data, so
    that the dashboard never looks broken on a fresh install.

## Implementation Decisions

### Modules to build or modify

- **Pricing/cost-insights module (extend, deepen).** Build on the existing
  `pricing` module by exposing the already-implemented but unused
  `cacheSavingsFor`, `nextTierDown`, and `tierForModel` through a small,
  pure, testable "cost insights" interface that takes a token breakdown +
  model and returns `{ actualCost, costOneTierDown, cacheSavings,
  recommendation }`. This is a deep module: simple inputs, no I/O, stable
  interface, rich behavior. It is the single source of truth for all cost math
  so the SQL and JS paths cannot drift.

- **Projection/budget module (new, pure).** A new deep module that, given a set
  of dated spend points, a budget, the current date, and a threshold, returns
  `{ spentSoFar, projectedMonthEnd, status: ok|approaching|over, pctOfBudget }`.
  No DB or React dependency so it can be unit-tested in isolation. Calendar math
  uses the existing Temporal conventions already established in the query layer.

- **Deltas helper (new, pure).** Given two period totals, returns absolute and
  percentage change plus direction. Reused by every KPI card.

- **Log parser (extend).** Extend the existing parser to additionally extract,
  per assistant turn and per session: tool-call names/counts (from the message
  content blocks), turn timing where derivable, and session first/last
  timestamps. New extraction is additive — existing `UsageEvent` fields and the
  one-row-per-usage-turn contract are preserved; new data lands in new columns
  and/or new tables. Parsing stays tolerant: missing rich fields are skipped,
  not fatal.

- **Persistence/schema (extend).** Add new columns/tables additively via the
  existing idempotent migration step (run on DB open). Candidate shapes: a
  `tool_calls` table (or per-event tool columns) keyed so re-sync is idempotent,
  and a small key/value `settings` table to persist the budget and threshold
  locally (keeping the "nothing leaves the machine" guarantee). Existing indexes
  and the `uuid` primary-key idempotency are retained.

- **Query layer (extend).** Add queries for: cost insights per scope, biggest
  cost drivers, tool-usage aggregates, hour/day-of-week buckets, single-session
  turn timelines, and period-over-period totals. All cost math routes through
  the cost-insights module's SQL expression so estimates stay consistent.

- **Global filter context (new, UI).** Lift the current Overview-only filters to
  an app-level URL-persisted filter state (date range, model, project) shared by
  all pages, continuing to use `nuqs`.

- **Export endpoint/util (new).** A serialization utility plus an API route that
  emits the active view as CSV or JSON, honoring the active filters. Runs in the
  Node runtime alongside the existing `/api/sync` and `/api/usage/summary`.

- **New/!modified UI surfaces.** Budget + projection card and KPI delta badges
  on Overview; a Cost Insights panel (savings, tier-down counterfactual, cost
  drivers); a Tools page or section; an activity heatmap component; a
  single-session timeline view; export buttons on relevant views. All built with
  the existing shadcn + Recharts + chart-color-variable conventions.

### Architectural decisions

- **Reuse the pipeline, don't replace it.** Ingestion → SQLite → query → server
  components stays. Every feature is an additive layer on top.
- **One cost engine.** All dollar figures derive from the cost-insights module
  (JS + SQL expression) so UI, exports, and projections agree.
- **Local-first preserved.** Budgets/settings persist in the local SQLite DB; no
  external storage, no network calls, no telemetry.
- **Additive, idempotent migrations & parsing.** No destructive schema changes;
  re-sync remains safe and duplicate-free via existing idempotency keys.
- **Estimates stay labeled as estimates** everywhere cost is shown.

### API / contract notes

- Extend the existing usage summary contract with optional cost-insight and
  delta fields rather than introducing a parallel shape.
- New export endpoint accepts the same filter query params (`days`/range,
  `model`, `project`) used elsewhere and returns `text/csv` or `application/json`.
- Settings (budget, threshold) read/written via a small local endpoint or server
  action; never exposed externally.

## Testing Decisions

**What makes a good test here:** tests should assert *external behavior* through
a module's public interface, not its internals. The pure modules are the prime
targets because they have simple inputs and deterministic outputs and no I/O.

- **Cost-insights module** — unit tests over fixed token breakdowns and models:
  known model → correct actual cost, correct one-tier-down cost, correct cache
  savings, correct recommendation; unknown model → zero/no-recommendation;
  cheapest tier → no tier-down. This locks the math that everything else trusts.
- **Projection/budget module** — unit tests for ok/approaching/over status,
  run-rate projection given elapsed vs. remaining days, threshold edges, and the
  no-budget case.
- **Deltas helper** — unit tests for increase, decrease, zero-baseline, and
  no-prior-period cases.
- **Parser extensions** — tests over small fixture `.jsonl` lines asserting that
  tool calls and session timing are extracted correctly, that logs missing the
  richer fields still parse (graceful degradation), and that existing usage
  extraction is unchanged. Re-parsing the same fixture yields no duplicates
  (idempotency), mirroring the spirit of the current `INSERT OR IGNORE` design.
- **Export serialization util** — tests that given rows + format it emits valid
  CSV/JSON and respects the selected columns.

Prior art: the existing parser/query/pricing functions are already pure and
fixture-friendly; new tests follow the same "feed known input, assert output"
shape. Query-layer and React components are lower priority for tests (they're
thin over the pure modules); the user can confirm which, if any, to cover.

**Modules the user wants tested:** to be confirmed — default recommendation is
to test the four pure modules (cost-insights, projection/budget, deltas, parser
extraction + export serialization) and skip UI-component tests.

## Out of Scope

- Real/actual billing reconciliation (Anthropic invoices, subscription-plan
  accounting). Costs remain list-price estimates.
- Any cloud sync, multi-machine aggregation, hosting, or auth — the tool stays
  single-user and local.
- Editing or writing back to Claude Code session logs.
- Real-time streaming dashboards / live tailing beyond the existing watch mode.
- Forecasting models beyond simple linear run-rate projection.
- Reading message *content* for semantic analysis (topics, code summaries);
  only structural/tool metadata is mined, not prompt text.
- Mobile-native apps; responsive web is sufficient.

## Further Notes

- The cost-intelligence work is partially pre-built: `cacheSavingsFor`,
  `nextTierDown`, and `tierForModel` already exist in the pricing module and are
  currently unused. The first slice is largely "surface what's already
  computed," making it a strong, low-risk tracer-bullet to ship first.
- Suggested sequencing (vertical slices): (1) Cost intelligence on Overview →
  (2) Budgets/projection/deltas → (3) Global filters + export → (4) Deeper log
  mining (parser + schema) → (5) Tool analytics, heatmap, session timeline that
  build on the new data.
- The deeper-mining schema change is the only one that touches ingestion; keep
  it additive so a failed parse never corrupts existing token/cost data.
- Keep all new dollar figures behind the same "estimated, not billed" labeling
  already used on the cost KPI.
