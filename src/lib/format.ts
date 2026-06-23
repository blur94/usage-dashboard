import { Temporal } from "@js-temporal/polyfill";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const full = new Intl.NumberFormat("en-US");

/** Compact token count, e.g. 1.2M, 14.3K. */
export function formatTokens(n: number): string {
  return compact.format(n);
}

/** Full grouped integer, e.g. 1,234,567. */
export function formatInt(n: number): string {
  return full.format(n);
}

/** Ratio (0–1) as a percentage string, e.g. 0.87 → "87.0%". */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Estimated USD cost. Small values (< $1) show 4 decimals (e.g. $0.0042),
 * larger values show 2 (e.g. $4.20). Exactly zero shows $0.00.
 */
export function formatCurrency(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Epoch ms → medium local date, e.g. "Jun 14, 2026". Uses Temporal. */
export function formatDateMs(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toLocaleString("en-US", {
    dateStyle: "medium",
  });
}

/** YYYY-MM-DD (local day key) → short axis label, e.g. "Jun 14". */
export function formatDayShort(dayKey: string): string {
  return Temporal.PlainDate.from(dayKey).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Strip a model id to a friendlier label, e.g. "claude-opus-4-8" → "Opus 4.8". */
export function formatModel(model: string): string {
  const m = model.replace(/^claude-/, "");
  const map: Record<string, string> = {
    "opus-4-8": "Opus 4.8",
    "opus-4-7": "Opus 4.7",
    "sonnet-4-6": "Sonnet 4.6",
    "haiku-4-5-20251001": "Haiku 4.5",
    "fable-5": "Fable 5",
  };
  return map[m] ?? model;
}
