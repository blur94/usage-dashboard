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
