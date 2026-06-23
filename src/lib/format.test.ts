import { describe, expect, it } from "vitest";
import { formatPercent } from "./format";

describe("formatPercent", () => {
  it("renders a 0–1 ratio as a one-decimal percentage", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
  });
});
