import { describe, expect, it } from "vitest";
import { annualisedReturn, annualisedVol, correlation, effectiveBreadth, maxDrawdown, sharpe } from "./stats";

describe("annualisedReturn", () => {
  it("is geometric, matching what the equity curve did", () => {
    // +10% then -10% is a net loss, not zero.
    expect(annualisedReturn([0.1, -0.1], 2)).toBeCloseTo(-0.01, 10);
  });

  it("annualises a constant daily rate", () => {
    const daily = Array.from({ length: 252 }, () => 0.001);
    expect(annualisedReturn(daily, 252)).toBeCloseTo(1.001 ** 252 - 1, 8);
  });

  it("handles an empty series", () => {
    expect(annualisedReturn([], 252)).toBe(0);
  });
});

describe("annualisedVol", () => {
  it("is zero for a constant series", () => {
    expect(annualisedVol([0.01, 0.01, 0.01], 252)).toBe(0);
  });
});

describe("sharpe", () => {
  it("is null when volatility is zero rather than infinite", () => {
    expect(sharpe([0.01, 0.01, 0.01], 252)).toBeNull();
  });

  it("is negative for a losing series", () => {
    expect(sharpe([-0.01, 0.005, -0.02, -0.01], 252)!).toBeLessThan(0);
  });
});

describe("maxDrawdown", () => {
  it("is zero for a series that only rises", () => {
    expect(maxDrawdown([0.01, 0.02, 0.01])).toBe(0);
  });

  it("measures peak to trough as a percentage", () => {
    expect(maxDrawdown([-0.5])).toBeCloseTo(50, 6);
  });

  it("keeps the worst drawdown after a recovery", () => {
    expect(maxDrawdown([-0.5, 1.0])).toBeCloseTo(50, 6);
  });
});

describe("correlation", () => {
  it("is 1 for identical series and -1 for inverted ones", () => {
    const a = [0.01, -0.02, 0.03, 0.01];
    expect(correlation(a, a)).toBeCloseTo(1, 10);
    expect(correlation(a, a.map((x) => -x))).toBeCloseTo(-1, 10);
  });

  it("is null when a series has no variance", () => {
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("effectiveBreadth", () => {
  it("collapses perfectly correlated instruments to roughly one bet", () => {
    const a = [0.01, -0.02, 0.03, 0.01, -0.01];
    const { breadth } = effectiveBreadth([a, a, a, a]);
    expect(breadth).toBeCloseTo(1, 6);
  });

  it("counts uncorrelated instruments closer to their number", () => {
    const { breadth } = effectiveBreadth([
      [0.01, -0.02, 0.03, 0.01, -0.01, 0.02],
      [-0.02, 0.01, 0.01, -0.03, 0.02, 0.01],
      [0.03, 0.02, -0.02, 0.01, 0.01, -0.03],
    ]);
    expect(breadth).toBeGreaterThan(1.5);
    expect(breadth).toBeLessThanOrEqual(3);
  });

  it("treats a strongly negative correlation as redundant, not diversifying", () => {
    // Either leg can be traded as the other inverted, so it is one bet.
    const a = [0.01, -0.02, 0.03, 0.01, -0.01];
    const { breadth } = effectiveBreadth([a, a.map((x) => -x)]);
    expect(breadth).toBeCloseTo(1, 6);
  });

  it("handles a single instrument", () => {
    expect(effectiveBreadth([[0.01, 0.02]]).breadth).toBe(1);
  });
});
