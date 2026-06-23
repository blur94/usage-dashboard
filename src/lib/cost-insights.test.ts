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
    // recommendation comes from the opus entry (highest savings)
    expect(agg.recommendation).toContain("Sonnet 4.6");
    expect(agg.recommendation).toContain("40%");
  });

  it("returns null recommendation when no entry has a recommendation", () => {
    const agg = aggregateInsights([
      {
        tokens: { input: oneMillion, output: 0, cacheCreation: 0, cacheRead: 0 },
        model: "claude-haiku-4-5-20251001",
      },
    ]);
    expect(agg.recommendation).toBeNull();
  });
});
