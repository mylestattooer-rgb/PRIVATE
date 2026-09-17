import { describe, expect, it } from "vitest";
import { buyAndHold, evaluate, PREREGISTERED_CRITERIA, splitBars, type CostModel } from "./evidence";
import type { BacktestResult } from "./backtest";
import type { Bar, ClosedTrade } from "./types";

const bars = (closes: number[], startDay = 1): Bar[] =>
  closes.map((close, i) => ({
    time: `2020-01-${String(startDay + i).padStart(2, "0")}T00:00:00.000Z`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000,
  }));

const FREE: CostModel = { halfSpreadBps: 0, commissionBps: 0, financingBpsPerBar: 0 };

describe("splitBars", () => {
  it("puts bars before the split date in-sample and the rest out", () => {
    const series = bars([1, 2, 3, 4, 5]);
    const { inSample, outOfSample } = splitBars(series, "2020-01-03T00:00:00.000Z");
    expect(inSample).toHaveLength(2);
    expect(outOfSample).toHaveLength(3);
    expect(outOfSample[0].time).toBe("2020-01-03T00:00:00.000Z");
  });

  it("handles a split date outside the series", () => {
    const series = bars([1, 2, 3]);
    expect(splitBars(series, "2019-01-01").inSample).toHaveLength(0);
    expect(splitBars(series, "2030-01-01").outOfSample).toHaveLength(0);
  });
});

describe("buyAndHold", () => {
  it("buys whole units at the first open and sells at the last close", () => {
    const result = buyAndHold(bars([100, 110, 120]), 1_000, FREE);
    expect(result.quantity).toBe(10);
    expect(result.entryPrice).toBe(100);
    expect(result.exitPrice).toBe(120);
    expect(result.endingEquity).toBe(1_200);
    expect(result.totalReturnPct).toBe(20);
  });

  it("pays spread on both sides, making the result strictly worse", () => {
    const free = buyAndHold(bars([100, 110, 120]), 1_000, FREE);
    const costly = buyAndHold(bars([100, 110, 120]), 1_000, { ...FREE, halfSpreadBps: 50 });
    expect(costly.endingEquity).toBeLessThan(free.endingEquity);
    expect(costly.totalCosts).toBeGreaterThan(0);
  });

  it("bleeds financing for every bar held", () => {
    const held = buyAndHold(bars([100, 100, 100, 100, 100]), 1_000, { ...FREE, financingBpsPerBar: 10 });
    expect(held.endingEquity).toBeLessThan(1_000);
    expect(held.totalReturnPct).toBeLessThan(0);
  });

  it("reports drawdown over the holding period", () => {
    expect(buyAndHold(bars([100, 50, 100]), 1_000, FREE).maxDrawdownPct).toBeCloseTo(50, 1);
  });

  it("reports honestly when one unit is unaffordable rather than buying a fraction", () => {
    const result = buyAndHold(bars([100, 200]), 50, FREE);
    expect(result.quantity).toBe(0);
    expect(result.totalReturnPct).toBe(0);
  });

  it("handles a series too short to trade", () => {
    expect(buyAndHold([], 1_000, FREE).endingEquity).toBe(1_000);
  });
});

const trade = (netPnl: number, grossPnl = netPnl): ClosedTrade => ({
  symbol: "TEST",
  side: "long",
  quantity: 1,
  entryPrice: 100,
  exitPrice: 100 + netPnl,
  entryTime: "2020-01-01T00:00:00.000Z",
  exitTime: "2020-01-02T00:00:00.000Z",
  grossPnl,
  commission: Math.abs(grossPnl - netPnl),
  netPnl,
  rMultiple: null,
  result: netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven",
  exitReason: "signal",
  source: "rule",
  setupTag: "test",
  mistakeTag: null,
});

const result = (trades: ClosedTrade[], overrides: Partial<BacktestResult["metrics"]> = {}): BacktestResult =>
  ({
    trades,
    metrics: {
      startingEquity: 10_000,
      endingEquity: 11_000,
      totalReturnPct: 10,
      maxDrawdownPct: 5,
      maxDrawdownAmount: 500,
      profitFactor: 2,
      sharpe: 1,
      barCount: 500,
      tradeCount: trades.length,
      commissionPaid: 50,
      financingPaid: 50,
      totalCosts: 100,
      journal: {} as BacktestResult["metrics"]["journal"],
      ...overrides,
    },
  }) as BacktestResult;

const baseline = (totalReturnPct: number) =>
  ({ totalReturnPct, name: "buy-and-hold" }) as Parameters<typeof evaluate>[1];

describe("evaluate", () => {
  const passingTrades = Array.from({ length: 40 }, (_, i) => trade(i % 3 === 0 ? -20 : 40));

  it("passes only when every criterion passes", () => {
    const evaluation = evaluate(result(passingTrades), baseline(5));
    expect(evaluation.passed).toBe(true);
    expect(evaluation.criteria.every((c) => c.passed)).toBe(true);
  });

  it("fails on too few trades, however good they were", () => {
    const evaluation = evaluate(result([trade(500), trade(500)]), baseline(5));
    expect(evaluation.passed).toBe(false);
    expect(evaluation.criteria.find((c) => c.id === 1)!.passed).toBe(false);
  });

  it("fails when the baseline did better", () => {
    const evaluation = evaluate(result(passingTrades), baseline(50));
    expect(evaluation.criteria.find((c) => c.id === 2)!.passed).toBe(false);
    expect(evaluation.passed).toBe(false);
  });

  it("fails on excessive drawdown", () => {
    const evaluation = evaluate(result(passingTrades, { maxDrawdownPct: 35 }), baseline(5));
    expect(evaluation.criteria.find((c) => c.id === 3)!.passed).toBe(false);
  });

  it("fails on a weak profit factor, and on a null one", () => {
    expect(evaluate(result(passingTrades, { profitFactor: 1.05 }), baseline(5)).passed).toBe(false);
    expect(evaluate(result(passingTrades, { profitFactor: null }), baseline(5)).passed).toBe(false);
  });

  it("measures costs against GROSS profit, not net", () => {
    // 10 gross profit total, 100 in costs — the strategy is trading for its broker.
    const trades = Array.from({ length: 40 }, () => trade(0.25, 0.25));
    const evaluation = evaluate(result(trades, { totalCosts: 100 }), baseline(5));
    expect(evaluation.criteria.find((c) => c.id === 5)!.passed).toBe(false);
  });

  it("fails when there is no gross profit at all rather than dividing by zero", () => {
    const losers = Array.from({ length: 40 }, () => trade(-10));
    const criterion = evaluate(result(losers), baseline(-50)).criteria.find((c) => c.id === 5)!;
    expect(criterion.passed).toBe(false);
    expect(criterion.observed).toBe("no gross profit");
  });

  it("fails a result that rests on one lucky trade", () => {
    // 39 small losers and one enormous winner: profitable overall, worthless.
    const trades = [...Array.from({ length: 39 }, () => trade(-10)), trade(5_000)];
    const evaluation = evaluate(result(trades), baseline(5));
    expect(evaluation.returnWithoutBestTradePct).toBeLessThan(0);
    expect(evaluation.criteria.find((c) => c.id === 6)!.passed).toBe(false);
    expect(evaluation.passed).toBe(false);
  });

  it("uses the pre-registered thresholds by default", () => {
    expect(PREREGISTERED_CRITERIA).toEqual({
      minTrades: 30,
      maxDrawdownPct: 20,
      minProfitFactor: 1.2,
      maxCostShareOfGrossProfitPct: 30,
    });
  });
});
