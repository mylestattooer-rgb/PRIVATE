import { describe, expect, it } from "vitest";
import { generateInsightText, MIN_TRADES_FOR_INSIGHT } from "./insights";
import { computeJournalStats, type StatTrade } from "./stats";

const manyTrades = (n: number, overrides: Partial<StatTrade> = {}): StatTrade[] =>
  Array.from({ length: n }, () => ({ result: "win", rMultiple: 1, setupTag: null, mistakeTag: null, ...overrides }));

describe("generateInsightText", () => {
  it("returns null below the minimum trade count — never manufactures a conclusion from insufficient data", () => {
    const stats = computeJournalStats(manyTrades(MIN_TRADES_FOR_INSIGHT - 1));
    expect(generateInsightText(stats)).toBeNull();
  });

  it("returns text once the minimum trade count is met", () => {
    const stats = computeJournalStats(manyTrades(MIN_TRADES_FOR_INSIGHT));
    const text = generateInsightText(stats);
    expect(text).not.toBeNull();
    expect(text).toContain("Win rate");
  });

  it("mentions the most common mistake only when it recurs at least twice", () => {
    const trades = manyTrades(MIN_TRADES_FOR_INSIGHT);
    trades[0] = { ...trades[0], mistakeTag: "early entry" };
    const stats = computeJournalStats(trades);
    expect(generateInsightText(stats)).not.toContain("early entry");

    trades[1] = { ...trades[1], mistakeTag: "early entry" };
    const stats2 = computeJournalStats(trades);
    expect(generateInsightText(stats2)).toContain("early entry");
  });
});
