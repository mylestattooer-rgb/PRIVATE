import { describe, expect, it, vi } from "vitest";
import { LiveExecutionError, resolveExit, runBacktest, type Strategy } from "./backtest";
import { createIdealBroker, createPaperBroker, type ExecutionAdapter } from "./broker";
import { DEFAULT_RISK_LIMITS, type RiskLimits } from "./risk";
import { holdSignal } from "./signal";
import type { Bar, Position, Signal } from "./types";

/** [open, high, low, close] per bar, one bar per day. */
type Row = [number, number, number, number];

const daily = (rows: Row[]): Bar[] =>
  rows.map(([open, high, low, close], i) => ({
    time: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    open,
    high,
    low,
    close,
    volume: 1_000,
  }));

/** Same calendar day, one bar per hour — so the daily-loss halt does not reset. */
const intraday = (rows: Row[]): Bar[] =>
  rows.map(([open, high, low, close], i) => ({
    time: `2026-01-01T${String(i + 9).padStart(2, "0")}:00:00.000Z`,
    open,
    high,
    low,
    close,
    volume: 1_000,
  }));

const enterLong = (stopPrice: number, targetPrice: number | null = null): Signal => ({
  symbol: "TEST",
  action: "enter_long",
  confidence: 0.9,
  stopPrice,
  targetPrice,
  rationale: "scripted",
  source: "rule",
});

/** Emits a given signal on a given bar index, holding otherwise. */
const scripted = (script: Record<number, Signal>): Strategy => ({
  name: "scripted",
  warmupBars: 1,
  decide: (ctx) => script[ctx.bars.length - 1] ?? holdSignal(ctx.symbol, "nothing scripted"),
});

const run = (bars: Bar[], strategy: Strategy, limits?: Partial<RiskLimits>, adapter?: ExecutionAdapter) =>
  runBacktest({
    symbol: "TEST",
    bars,
    strategy,
    adapter: adapter ?? createIdealBroker(),
    startingCash: 10_000,
    limits: { ...DEFAULT_RISK_LIMITS, ...limits },
    dataSourceId: "fixture",
  });

describe("live execution guard", () => {
  it("refuses to run against an adapter that can move real money", async () => {
    const live: ExecutionAdapter = {
      name: "metatrader5",
      isLive: true,
      submit: vi.fn(),
    };
    await expect(run(daily([[100, 101, 99, 100]]), scripted({}), undefined, live)).rejects.toThrow(
      LiveExecutionError,
    );
    expect(live.submit).not.toHaveBeenCalled();
  });
});

describe("look-ahead prevention", () => {
  const bars = daily([
    [100, 101, 99, 100],
    [101, 102, 100, 101],
    [102, 103, 101, 102],
    [103, 104, 102, 103],
    [104, 105, 103, 104],
  ]);

  it("shows a strategy only the bars up to and including its decision bar", async () => {
    const seen: number[] = [];
    const lastCloseSeen: number[] = [];

    await run(bars, {
      name: "observer",
      warmupBars: 1,
      decide(ctx) {
        seen.push(ctx.bars.length);
        lastCloseSeen.push(ctx.bars[ctx.bars.length - 1].close);
        return holdSignal(ctx.symbol, "observing");
      },
    });

    // Decisions happen on bars 0..3; the final bar has no bar after it to
    // execute against, so it is never a decision bar.
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(lastCloseSeen).toEqual([100, 101, 102, 103]);
  });

  it("hands the strategy a frozen slice with nothing past the decision bar", async () => {
    const peeks: unknown[] = [];

    await run(bars, {
      name: "peeker",
      warmupBars: 1,
      decide(ctx) {
        expect(Object.isFrozen(ctx.bars)).toBe(true);
        // The only way to ask for the future is to index past the end.
        peeks.push((ctx.bars as Bar[])[ctx.bars.length]);
        return holdSignal(ctx.symbol, "peeking");
      },
    });

    expect(peeks).toHaveLength(4);
    expect(peeks.every((p) => p === undefined)).toBe(true);
  });

  it("gives a strategy that would cheat on tomorrow's bar nothing to trade on", async () => {
    // This strategy only buys when the NEXT bar closes higher — which it cannot
    // see. Every bar in the fixture closes higher, so a leaking engine would
    // trade on all of them.
    const result = await run(bars, {
      name: "cheater",
      warmupBars: 1,
      decide(ctx) {
        const tomorrow = (ctx.bars as Bar[])[ctx.bars.length];
        if (tomorrow && tomorrow.close > ctx.bars[ctx.bars.length - 1].close) {
          return enterLong(ctx.bars[ctx.bars.length - 1].close - 5);
        }
        return holdSignal(ctx.symbol, "cannot see tomorrow");
      },
    });

    expect(result.trades).toHaveLength(0);
    expect(result.fills).toHaveLength(0);
  });

  it("does not warm up a strategy before it has the bars it asked for", async () => {
    const seen: number[] = [];
    await run(bars, {
      name: "late",
      warmupBars: 3,
      decide(ctx) {
        seen.push(ctx.bars.length);
        return holdSignal(ctx.symbol, "late");
      },
    });
    expect(seen).toEqual([3, 4]);
  });
});

describe("order execution timing", () => {
  it("fills a decision made on bar i at bar i+1's open", async () => {
    const bars = daily([
      [100, 101, 99, 100],
      [105, 106, 104, 105],
      [106, 107, 105, 106],
    ]);
    const result = await run(bars, scripted({ 0: enterLong(90) }));

    expect(result.fills).toHaveLength(2); // entry, then the end-of-data close
    expect(result.fills[0].price).toBe(105);
    expect(result.fills[0].time).toBe(bars[1].time);
    // Risk budget of 1% (100) over 10 of risk per unit at a reference of 100.
    expect(result.fills[0].quantity).toBe(10);
  });

  it("applies slippage against the order through the paper broker", async () => {
    const bars = daily([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
    ]);
    const result = await run(
      bars,
      scripted({ 0: enterLong(90) }),
      undefined,
      createPaperBroker({ slippageBps: 10, commission: { perUnit: 0, percentOfNotional: 0, minimum: 0 } }),
    );
    // A buy fills 10bps above the open, never below.
    expect(result.fills[0].price).toBeCloseTo(100.1, 6);
    expect(result.fills[0].slippage).toBeCloseTo(0.1, 6);
  });
});

describe("resting stops and targets", () => {
  it("fills a long stop at the stop price when the bar trades through it", () => {
    const position: Position = {
      symbol: "TEST",
      side: "long",
      quantity: 10,
      avgEntryPrice: 100,
      stopPrice: 90,
      targetPrice: 130,
      openedAt: "2026-01-01T00:00:00.000Z",
      riskPerUnit: 10,
    };
    const exit = resolveExit(position, { time: "t", open: 95, high: 96, low: 85, close: 88, volume: 1 });
    expect(exit).toEqual({ price: 90, reason: "stop" });
  });

  it("fills at the open, worse than the stop, when the bar gaps through it", () => {
    const position: Position = {
      symbol: "TEST",
      side: "long",
      quantity: 10,
      avgEntryPrice: 100,
      stopPrice: 90,
      targetPrice: null,
      openedAt: "2026-01-01T00:00:00.000Z",
      riskPerUnit: 10,
    };
    const exit = resolveExit(position, { time: "t", open: 80, high: 82, low: 78, close: 79, volume: 1 });
    expect(exit).toEqual({ price: 80, reason: "stop" });
  });

  it("assumes the stop filled first when one bar contains both stop and target", () => {
    const position: Position = {
      symbol: "TEST",
      side: "long",
      quantity: 10,
      avgEntryPrice: 100,
      stopPrice: 90,
      targetPrice: 130,
      openedAt: "2026-01-01T00:00:00.000Z",
      riskPerUnit: 10,
    };
    const exit = resolveExit(position, { time: "t", open: 100, high: 135, low: 85, close: 120, volume: 1 });
    expect(exit!.reason).toBe("stop");
  });

  it("stops a live position out end to end and reports a loss", async () => {
    const bars = daily([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [95, 96, 85, 88],
      [88, 89, 87, 88],
    ]);
    const result = await run(bars, scripted({ 0: enterLong(90) }));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("stop");
    expect(result.trades[0].exitPrice).toBe(90);
    expect(result.trades[0].result).toBe("loss");
    // Entered at 100 with a 10-wide stop, exited at the stop: a clean −1R.
    expect(result.trades[0].rMultiple).toBe(-1);
    expect(result.trades[0].setupTag).toBe("scripted");
  });

  it("takes a target and reports the reward-to-risk as R", async () => {
    const bars = daily([
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [110, 135, 109, 130],
      [130, 131, 129, 130],
    ]);
    const result = await run(bars, scripted({ 0: enterLong(90, 130) }));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("target");
    expect(result.trades[0].exitPrice).toBe(130);
    expect(result.trades[0].rMultiple).toBe(3);
  });
});

describe("daily-loss halt", () => {
  const bars = intraday([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [95, 96, 89, 90],
    [92, 93, 91, 92],
    [92, 93, 91, 92],
  ]);
  // 5% risk per trade and no notional cap, so one adverse move is enough to
  // breach a 3% daily loss limit.
  const limits = { maxRiskPerTradePct: 5, maxPositionPct: 100, maxDailyLossPct: 3 };

  it("trips, flattens the open position, and blocks further entries", async () => {
    const result = await run(bars, scripted({ 0: enterLong(85), 3: enterLong(80) }), limits);

    expect(result.killSwitchTrips).toHaveLength(1);
    expect(result.killSwitchTrips[0].reason).toContain("3% limit");

    const flattened = result.trades.find((t) => t.exitReason === "kill_switch");
    expect(flattened).toBeDefined();
    expect(flattened!.exitPrice).toBe(92);

    expect(result.finalAccount.positions).toHaveLength(0);
    expect(result.rejections.some((r) => r.reason === "kill_switch_tripped")).toBe(true);
  });

  it("rides the position out when flattening is disabled", async () => {
    const result = await runBacktest({
      symbol: "TEST",
      bars,
      strategy: scripted({ 0: enterLong(85) }),
      adapter: createIdealBroker(),
      startingCash: 10_000,
      limits: { ...DEFAULT_RISK_LIMITS, ...limits },
      flattenOnKillSwitch: false,
    });
    expect(result.killSwitchTrips).toHaveLength(1);
    expect(result.trades.some((t) => t.exitReason === "kill_switch")).toBe(false);
    expect(result.trades[0].exitReason).toBe("end_of_data");
  });
});

describe("result bookkeeping", () => {
  const bars = daily([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [100, 101, 99, 100],
  ]);

  it("closes anything still open at the last close, leaving no dangling position", async () => {
    const result = await run(bars, scripted({ 0: enterLong(90) }));
    expect(result.finalAccount.positions).toHaveLength(0);
    expect(result.trades[0].exitReason).toBe("end_of_data");
    expect(result.trades[0].exitPrice).toBe(100);
  });

  it("logs why signals were turned down, but not every hold", async () => {
    const result = await run(bars, scripted({ 0: enterLong(110) }));
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe("stop_on_wrong_side");
    expect(result.rejections[0].time).toBe(bars[0].time);
  });

  it("records an equity point for every bar", async () => {
    const result = await run(bars, scripted({}));
    expect(result.equityCurve).toHaveLength(bars.length);
    expect(result.equityCurve.every((p) => p.equity === 10_000)).toBe(true);
  });

  it("is deterministic — the same inputs produce byte-identical results", async () => {
    const strategy = scripted({ 0: enterLong(90) });
    const a = await run(bars, strategy);
    const b = await run(bars, strategy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects malformed bar data rather than backtesting on it", async () => {
    const broken: Bar[] = [{ time: "2026-01-01T00:00:00.000Z", open: 100, high: 90, low: 95, close: 99, volume: 1 }];
    await expect(run(broken, scripted({}))).rejects.toThrow(/malformed/);
  });

  it("rejects out-of-order bars", async () => {
    const reversed = [...daily([[100, 101, 99, 100], [100, 101, 99, 100]])].reverse();
    await expect(run(reversed, scripted({}))).rejects.toThrow(/out-of-order/);
  });

  it("handles an empty series without throwing", async () => {
    const result = await run([], scripted({}));
    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(0);
    expect(result.metrics.tradeCount).toBe(0);
  });
});
