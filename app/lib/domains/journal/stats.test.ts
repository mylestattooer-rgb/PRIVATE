import { describe, expect, it } from "vitest";
import { computeJournalStats, type StatTrade } from "./stats";

const trade = (overrides: Partial<StatTrade> = {}): StatTrade => ({
  result: null,
  rMultiple: null,
  setupTag: null,
  mistakeTag: null,
  ...overrides,
});

describe("computeJournalStats", () => {
  it("returns zeroed stats and nulls for an empty journal", () => {
    const stats = computeJournalStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRatePct).toBeNull();
    expect(stats.avgRMultiple).toBeNull();
    expect(stats.bestSetupTag).toBeNull();
    expect(stats.mostCommonMistakeTag).toBeNull();
  });

  it("computes win rate over decided trades only, excluding breakeven", () => {
    const stats = computeJournalStats([
      trade({ result: "win" }),
      trade({ result: "win" }),
      trade({ result: "loss" }),
      trade({ result: "breakeven" }),
    ]);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.breakeven).toBe(1);
    expect(stats.winRatePct).toBeCloseTo(66.67, 1);
  });

  it("averages R multiples only over trades that have one", () => {
    const stats = computeJournalStats([trade({ rMultiple: 2 }), trade({ rMultiple: -1 }), trade({ rMultiple: null })]);
    expect(stats.avgRMultiple).toBe(0.5);
  });

  it("ranks setup tags by average R and picks best/worst", () => {
    const stats = computeJournalStats([
      trade({ setupTag: "A", rMultiple: 3 }),
      trade({ setupTag: "A", rMultiple: 1 }),
      trade({ setupTag: "B", rMultiple: -2 }),
    ]);
    expect(stats.bestSetupTag).toEqual({ tag: "A", avgR: 2 });
    expect(stats.worstSetupTag).toEqual({ tag: "B", avgR: -2 });
  });

  it("does not report a worstSetupTag when only one setup tag exists", () => {
    const stats = computeJournalStats([trade({ setupTag: "A", rMultiple: 1 })]);
    expect(stats.bestSetupTag).toEqual({ tag: "A", avgR: 1 });
    expect(stats.worstSetupTag).toBeNull();
  });

  it("finds the most common mistake tag", () => {
    const stats = computeJournalStats([
      trade({ mistakeTag: "early entry" }),
      trade({ mistakeTag: "early entry" }),
      trade({ mistakeTag: "oversized" }),
    ]);
    expect(stats.mostCommonMistakeTag).toEqual({ tag: "early entry", count: 2 });
  });
});
