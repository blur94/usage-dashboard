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
