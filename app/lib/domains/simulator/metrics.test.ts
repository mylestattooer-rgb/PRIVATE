import { describe, expect, it } from "vitest";
import { computeMetrics, maxDrawdown, profitFactor, sharpeRatio } from "./metrics";
import type { ClosedTrade, EquityPoint } from "./types";

const curve = (equities: number[]): EquityPoint[] =>
  equities.map((equity, i) => ({
    time: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    equity,
    cash: equity,
  }));

const trade = (netPnl: number, rMultiple: number | null = null): ClosedTrade => ({
  symbol: "TEST",
  side: "long",
  quantity: 1,
  entryPrice: 100,
  exitPrice: 100 + netPnl,
  entryTime: "2026-01-01T00:00:00.000Z",
  exitTime: "2026-01-02T00:00:00.000Z",
  grossPnl: netPnl,
  commission: 0,
  netPnl,
  rMultiple,
  result: netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven",
  exitReason: "signal",
  source: "rule",
  setupTag: "test",
  mistakeTag: null,
});

describe("maxDrawdown", () => {
  it("is zero for a curve that only rises", () => {
    expect(maxDrawdown(curve([100, 110, 120])).pct).toBe(0);
  });

  it("measures peak to trough, not start to end", () => {
    const { pct, amount } = maxDrawdown(curve([100, 200, 150, 400]));
    expect(pct).toBe(25);
    expect(amount).toBe(50);
  });

  it("keeps the worst drawdown even after a full recovery", () => {
    expect(maxDrawdown(curve([100, 50, 100])).pct).toBe(50);
  });

  it("is zero for an empty curve", () => {
    expect(maxDrawdown([]).pct).toBe(0);
  });
});

describe("profitFactor", () => {
  it("divides gross profit by gross loss", () => {
    expect(profitFactor([trade(300), trade(-100), trade(-50)])).toBe(2);
  });

  it("returns null with no losers rather than reporting infinity", () => {
    expect(profitFactor([trade(100), trade(50)])).toBeNull();
  });

  it("returns null for no trades at all", () => {
    expect(profitFactor([])).toBeNull();
  });
});

describe("sharpeRatio", () => {
  it("returns null for a flat curve with no variance", () => {
    expect(sharpeRatio(curve([100, 100, 100, 100]))).toBeNull();
  });

  it("returns null when there is not enough history", () => {
    expect(sharpeRatio(curve([100, 110]))).toBeNull();
  });

  it("is positive for a curve that trends up and negative for one that trends down", () => {
    expect(sharpeRatio(curve([100, 105, 103, 112, 118]))!).toBeGreaterThan(0);
    expect(sharpeRatio(curve([100, 95, 97, 88, 82]))!).toBeLessThan(0);
  });
});

describe("computeMetrics", () => {
  it("reports return, drawdown and trade counts together", () => {
    const metrics = computeMetrics(curve([10_000, 10_500, 10_200, 11_000]), [trade(600), trade(-100)], 12);

    expect(metrics.startingEquity).toBe(10_000);
    expect(metrics.endingEquity).toBe(11_000);
    expect(metrics.totalReturnPct).toBe(10);
    expect(metrics.maxDrawdownPct).toBeCloseTo(2.857, 3);
    expect(metrics.tradeCount).toBe(2);
    expect(metrics.commissionPaid).toBe(12);
  });

  it("delegates win rate and average R to the journal domain", () => {
    const metrics = computeMetrics(curve([10_000, 10_100]), [trade(100, 2), trade(-50, -1), trade(200, 3)], 0);
    expect(metrics.journal.totalTrades).toBe(3);
    expect(metrics.journal.winRatePct).toBeCloseTo(66.67, 1);
    expect(metrics.journal.avgRMultiple).toBeCloseTo(1.333, 3);
    // Strategy name rides in as the setup tag, so the ranking is meaningful.
    expect(metrics.journal.bestSetupTag?.tag).toBe("test");
  });

  it("handles a run with no bars", () => {
    const metrics = computeMetrics([], [], 0);
    expect(metrics.startingEquity).toBe(0);
    expect(metrics.totalReturnPct).toBe(0);
    expect(metrics.sharpe).toBeNull();
  });
});
