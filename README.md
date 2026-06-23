# Claude Code Token Usage Dashboard

A local, private dashboard that reads Claude Code's own session logs from
`%USERPROFILE%\.claude\projects\`, aggregates token usage into SQLite, and
visualizes it. No external services, no API keys, nothing leaves your machine.

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4
- shadcn/ui (preset `b5KHubjyC` — mira style, sky theme)
- better-sqlite3 at `data/usage-dashboard.db` (gitignored)
- Recharts (chart colors wired to `var(--chart-1..5)`)
- `@js-temporal/polyfill` for all date logic, `nuqs` for URL-persisted filters

## Setup

```bash
pnpm install        # native better-sqlite3 build is allowlisted in package.json
pnpm sync           # parse all session logs and seed the database
pnpm dev            # http://localhost:3000
```

## Commands

| Command          | What it does                                                    |
| ---------------- | -------------------------------------------------------------- |
| `pnpm sync`      | One-shot parse of all session logs into SQLite (idempotent).   |
| `pnpm watch`     | Initial sync, then auto-sync on every change to a `.jsonl` log.|
| `pnpm dev`       | Run the dashboard.                                             |
| `pnpm build`     | Production build.                                              |
| `pnpm typecheck` | `tsc --noEmit`.                                               |

You can also sync from inside the app with the **Sync** button in the header
(`POST /api/sync`), which returns the count of newly inserted rows.

## Pages

- **Overview** — KPI cards (tokens this month, cache hit rate, top model this
  week, active projects) and a daily input-vs-output stacked bar chart. The date
  range and model filters persist in the URL.
- **Projects** — sortable table, one row per project; click to drill into its
  sessions.
- **Models** — total token consumption by model across all time.

## How parsing works

Each assistant turn in a session `.jsonl` that carries a `message.usage` block
becomes one row, keyed by its message `uuid` (the idempotency key, so re-syncing
never duplicates). Synthetic placeholder turns are skipped. The project path is
taken from the log's `cwd` field; its URL id is a short SHA-256 of that path.
