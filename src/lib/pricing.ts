/**
 * Estimated cost model for Claude Code token usage.
 *
 * Prices are public per-model list prices (USD per 1M tokens) and are applied to
 * the token counts in the logs to produce an ESTIMATE — not actual billing.
 * Subscription plans, discounts, and the exact cache TTL mix are not reflected.
 *
 * Source: Claude usage dashboard PRD pricing reference (June 2026).
 */

export interface ModelTier {
  /** Canonical key used for the four comparison models. */
  key: "haiku" | "sonnet" | "opus" | "fable";
  label: string;
  /** 1 = cheapest. Used for the one-tier-down counterfactual. */
  tier: number;
  /** SQL LIKE pattern matching this family's model ids. */
  like: string;
  /** USD per 1M input tokens (standard). */
  inputPerMTok: number;
  /** USD per 1M output tokens (standard). */
  outputPerMTok: number;
}

// Cheapest -> most expensive. Matched by model-id prefix so dated ids
// (e.g. claude-haiku-4-5-20251001) and future minor versions resolve.
// Mythos shares Fable pricing.
export const MODEL_TIERS: ModelTier[] = [
  { key: "haiku", label: "Haiku 4.5", tier: 1, like: "claude-haiku-%", inputPerMTok: 1, outputPerMTok: 5 },
  { key: "sonnet", label: "Sonnet 4.6", tier: 2, like: "claude-sonnet-%", inputPerMTok: 3, outputPerMTok: 15 },
  { key: "opus", label: "Opus 4.8", tier: 3, like: "claude-opus-%", inputPerMTok: 5, outputPerMTok: 25 },
  { key: "fable", label: "Fable 5", tier: 4, like: "claude-fable-%", inputPerMTok: 10, outputPerMTok: 50 },
];

const MYTHOS_LIKE = "claude-mythos-%";

// Cache-write tokens bill at 2x input (1-hour TTL — what Claude Code uses);
// cache-read tokens bill at 0.1x input (90% cheaper than fresh input).
export const CACHE_WRITE_MULTIPLIER = 2;
export const CACHE_READ_MULTIPLIER = 0.1;

// Batch API is a flat 50% discount on both input and output.
export const BATCH_DISCOUNT = 0.5;

/** Fallback input/output split when only a combined total is available. */
export const FALLBACK_INPUT_RATIO = 0.7;
export const FALLBACK_OUTPUT_RATIO = 0.3;

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** Resolve the comparison tier for a model id, or null if unknown. */
export function tierForModel(model: string): ModelTier | null {
  const prefix = (like: string) => like.replace(/%$/, "");
  if (model.startsWith(prefix(MYTHOS_LIKE))) {
    return MODEL_TIERS.find((t) => t.key === "fable") ?? null;
  }
  return MODEL_TIERS.find((t) => model.startsWith(prefix(t.like))) ?? null;
}

/** The next cheaper tier below a model, or null if already cheapest/unknown. */
export function nextTierDown(model: string): ModelTier | null {
  const tier = tierForModel(model);
  if (!tier || tier.tier === 1) return null;
  return MODEL_TIERS.find((t) => t.tier === tier.tier - 1) ?? null;
}

/**
 * Estimated USD cost of a token breakdown billed at a given tier's rates.
 * Cache-creation and cache-read tokens are priced off the input rate.
 */
export function costFor(
  tokens: TokenBreakdown,
  tier: ModelTier,
  opts: { batch?: boolean } = {},
): number {
  const factor = opts.batch ? BATCH_DISCOUNT : 1;
  const inRate = (tier.inputPerMTok / 1_000_000) * factor;
  const outRate = (tier.outputPerMTok / 1_000_000) * factor;
  return (
    tokens.input * inRate +
    tokens.output * outRate +
    tokens.cacheCreation * inRate * CACHE_WRITE_MULTIPLIER +
    tokens.cacheRead * inRate * CACHE_READ_MULTIPLIER
  );
}

function rateCaseSql(field: "inputPerMTok" | "outputPerMTok"): string {
  const whens = [
    ...MODEL_TIERS.map(
      (t) => `WHEN model LIKE '${t.like}' THEN ${t[field] / 1_000_000}`,
    ),
    `WHEN model LIKE '${MYTHOS_LIKE}' THEN ${
      (MODEL_TIERS.find((t) => t.key === "fable")?.[field] ?? 0) / 1_000_000
    }`,
  ].join(" ");
  return `CASE ${whens} ELSE 0 END`;
}

/**
 * SQL expression (in USD) for the estimated cost of a single events row at the
 * actual model's standard rates. Reference inside SUM(...). Unknown models = 0.
 */
export function costExpressionSql(): string {
  const inRate = rateCaseSql("inputPerMTok");
  const outRate = rateCaseSql("outputPerMTok");
  return (
    `(input_tokens * (${inRate})` +
    ` + output_tokens * (${outRate})` +
    ` + cache_creation_input_tokens * (${inRate}) * ${CACHE_WRITE_MULTIPLIER}` +
    ` + cache_read_input_tokens * (${inRate}) * ${CACHE_READ_MULTIPLIER})`
  );
}

/**
 * What the cache_read tokens this scope consumed would have cost as *fresh*
 * input (i.e. the gross savings from prompt caching), minus what they actually
 * cost as cache reads. Returns dollars saved.
 */
export function cacheSavingsFor(cacheReadTokens: number, tier: ModelTier): number {
  const inRate = tier.inputPerMTok / 1_000_000;
  return cacheReadTokens * inRate * (1 - CACHE_READ_MULTIPLIER);
}
