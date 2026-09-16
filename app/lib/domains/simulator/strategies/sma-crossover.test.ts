import { describe, expect, it } from "vitest";
import { createSmaCrossoverStrategy, DEFAULT_SMA_CONFIG } from "./sma-crossover";
import type { StrategyContext } from "../backtest";
import type { Bar } from "../types";

const barsFromCloses = (closes: number[]): Bar[] =>
  closes.map((close, i) => ({
    time: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000,
  }));

const ctx = (closes: number[], position: StrategyContext["position"] = null): StrategyContext => ({
  symbol: "TEST",
  bars: barsFromCloses(closes),
  position,
  equity: 10_000,
});

const strategy = createSmaCrossoverStrategy({ fastPeriod: 2, slowPeriod: 4, atrPeriod: 2 });

describe("createSmaCrossoverStrategy", () => {
  it("names itself after its periods and declares its warmup", () => {
    expect(strategy.name).toBe("sma-2/4");
    // Slow period 4, plus one bar for the previous-bar comparison.
    expect(strategy.warmupBars).toBe(5);
    expect(createSmaCrossoverStrategy().warmupBars).toBe(DEFAULT_SMA_CONFIG.slowPeriod + 1);
  });

  it("holds while it lacks history for both averages", () => {
    expect(strategy.decide(ctx([10, 11])).action).toBe("hold");
  });

  it("enters long on an upward cross, with a stop below price", () => {
    const signal = strategy.decide(ctx([20, 18, 16, 14, 13, 40]));
    expect(signal.action).toBe("enter_long");
    expect(signal.stopPrice).not.toBeNull();
    expect(signal.stopPrice!).toBeLessThan(40);
    expect(signal.source).toBe("rule");
  });

  it("places the target at the configured reward-to-risk multiple of the stop distance", () => {
    const rr2 = createSmaCrossoverStrategy({ fastPeriod: 2, slowPeriod: 4, atrPeriod: 2, rewardToRisk: 2 });
    const signal = rr2.decide(ctx([20, 18, 16, 14, 13, 40]));
    const stopDistance = 40 - signal.stopPrice!;
    expect(signal.targetPrice!).toBeCloseTo(40 + stopDistance * 2, 6);
  });

  it("leaves the target null when reward-to-risk is zero", () => {
    const noTarget = createSmaCrossoverStrategy({ fastPeriod: 2, slowPeriod: 4, atrPeriod: 2, rewardToRisk: 0 });
    expect(noTarget.decide(ctx([20, 18, 16, 14, 13, 40])).targetPrice).toBeNull();
  });

  it("does not re-enter on a bar after the cross already happened", () => {
    expect(strategy.decide(ctx([20, 18, 16, 14, 13, 40, 41])).action).toBe("hold");
  });

  it("holds an open position until the opposite cross", () => {
    const position = {
      symbol: "TEST",
      side: "long" as const,
      quantity: 10,
      avgEntryPrice: 40,
      stopPrice: 35,
      targetPrice: null,
      openedAt: "2026-01-01T00:00:00.000Z",
      riskPerUnit: 5,
    };
    expect(strategy.decide(ctx([10, 12, 14, 16, 18, 20], position)).action).toBe("hold");
    expect(strategy.decide(ctx([30, 32, 34, 36, 38, 5], position)).action).toBe("exit");
  });

  it("never emits an entry without a stop, so risk.ts can always size it", () => {
    const signal = strategy.decide(ctx([20, 18, 16, 14, 13, 40]));
    if (signal.action === "enter_long" || signal.action === "enter_short") {
      expect(signal.stopPrice).not.toBeNull();
    }
  });

  it("holds rather than emitting a stop at or below zero", () => {
    // Prices near zero with a wide ATR multiple would put the stop underwater.
    const wide = createSmaCrossoverStrategy({
      fastPeriod: 2,
      slowPeriod: 4,
      atrPeriod: 2,
      atrStopMultiple: 100,
    });
    expect(wide.decide(ctx([20, 18, 16, 14, 13, 40])).action).toBe("hold");
  });
});
