// The backtest runner. One symbol, one strategy, bar by bar.
//
// The property this file exists to guarantee is **no look-ahead leakage**
// (PRODUCT_SPEC.md names it explicitly as a Simulator requirement). Two rules
// enforce it, and both are structural rather than conventional:
//
//   1. A strategy deciding on bar `i` is handed a frozen copy of bars 0..i.
//      There is no path from the strategy to bar i+1 — not a slice offset, not
//      a mutable reference into the full series.
//   2. An order produced on bar `i` executes against bar `i+1`. A decision can
//      never transact at a price that was known when it was made.
//
// Resting stop/target orders are the one exception to rule 2, and only in the
// direction that makes the result worse or equal: they fill within the bar they
// are touched, at the stop price, or at the open when the bar gapped straight
// through it.
//
// Per-bar sequence:
//   1. execute orders queued on the previous bar, at this bar's open
//   2. check this bar's range against open stops and targets
//   3. mark equity at this bar's close; evaluate the daily-loss halt
//   4. ask the strategy for a signal; risk-assess it; queue anything approved
//   5. record the equity point

import { assertValidSeries } from "./datasource";
import { computeMetrics, type BacktestMetrics } from "./metrics";
import { applyFill, applyFinancing, computeEquity, emptyAccount, findPosition } from "./portfolio";
import {
  assessSignal,
  DEFAULT_RISK_LIMITS,
  evaluateKillSwitch,
  openTradingDay,
  type KillSwitchState,
  type RiskLimits,
  type RiskRejectionReason,
} from "./risk";
import type { ExecutionAdapter } from "./broker";
import type {
  AccountState,
  Bar,
  ClosedTrade,
  EquityPoint,
  ExitReason,
  Fill,
  Order,
  Position,
  Signal,
} from "./types";

export type StrategyContext = {
  symbol: string;
  /** Bars 0..i inclusive, where i is the bar being decided on. Frozen: there is
   *  nothing after the decision bar to reach for. */
  readonly bars: readonly Bar[];
  position: Position | null;
  equity: number;
};

export type Strategy = {
  readonly name: string;
  /** Bars required before `decide` is called at all. A strategy that needs a
   *  200-period average must say so, or its first decisions are noise. */
  readonly warmupBars: number;
  decide(ctx: StrategyContext): Signal;
};

export type RejectionRecord = {
  time: string;
  symbol: string;
  action: Signal["action"];
  reason: RiskRejectionReason;
  detail: string;
};

export type BacktestConfig = {
  symbol: string;
  bars: Bar[];
  strategy: Strategy;
  adapter: ExecutionAdapter;
  startingCash: number;
  limits?: RiskLimits;
  dataSourceId?: string;
  /** Close open positions when the daily-loss halt trips, rather than riding
   *  them out. Default true: a halt that stops new risk while leaving existing
   *  risk running is only half a halt. */
  flattenOnKillSwitch?: boolean;
  /** Bars per year, for the Sharpe annualization only. 252 ≈ daily equities. */
  periodsPerYear?: number;
  /** Overnight financing charged per BAR on open position notional, in basis
   *  points. On a leveraged instrument this is often the difference between a
   *  strategy that works and one that pays its broker to lose slowly. */
  financingBpsPerBar?: number;
};

export type BacktestResult = {
  strategy: string;
  symbol: string;
  dataSourceId: string;
  adapter: string;
  startingCash: number;
  equityCurve: EquityPoint[];
  fills: Fill[];
  trades: ClosedTrade[];
  /** Every signal the Risk Manager turned down, and why. Usually the most
   *  informative part of a run that did nothing. */
  rejections: RejectionRecord[];
  killSwitchTrips: { day: string; reason: string }[];
  metrics: BacktestMetrics;
  finalAccount: AccountState;
};

export class LiveExecutionError extends Error {
  constructor(adapterName: string) {
    super(
      `runBacktest refused to run against live adapter "${adapterName}". ` +
        `Backtests execute against historical bars and must never reach a real venue.`,
    );
    this.name = "LiveExecutionError";
  }
}

function tradingDay(isoTime: string): string {
  return isoTime.slice(0, 10);
}

/**
 * Where a resting stop or target would fill inside this bar, if at all.
 *
 * Stops are checked before targets: when a single bar's range contains both,
 * there is no way to know from bar data which came first, so the run assumes
 * the loss. Any other choice systematically overstates results.
 */
export function resolveExit(
  position: Position,
  bar: Bar,
): { price: number; reason: Extract<ExitReason, "stop" | "target"> } | null {
  const { stopPrice, targetPrice, side } = position;

  if (stopPrice !== null) {
    if (side === "long" && bar.low <= stopPrice) {
      // A gap below the stop fills at the open, not the stop.
      return { price: Math.min(stopPrice, bar.open), reason: "stop" };
    }
    if (side === "short" && bar.high >= stopPrice) {
      return { price: Math.max(stopPrice, bar.open), reason: "stop" };
    }
  }

  if (targetPrice !== null) {
    if (side === "long" && bar.high >= targetPrice) {
      return { price: Math.max(targetPrice, bar.open), reason: "target" };
    }
    if (side === "short" && bar.low <= targetPrice) {
      return { price: Math.min(targetPrice, bar.open), reason: "target" };
    }
  }

  return null;
}

function closingOrder(id: string, position: Position, source: Order["source"]): Order {
  return {
    id,
    symbol: position.symbol,
    side: position.side === "long" ? "sell" : "buy",
    quantity: position.quantity,
    intent: "close",
    positionSide: position.side,
    stopPrice: null,
    targetPrice: null,
    riskAmount: 0,
    source,
  };
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const {
    symbol,
    bars,
    strategy,
    adapter,
    startingCash,
    limits = DEFAULT_RISK_LIMITS,
    dataSourceId = "unspecified",
    flattenOnKillSwitch = true,
    periodsPerYear = 252,
    financingBpsPerBar = 0,
  } = config;

  if (adapter.isLive) throw new LiveExecutionError(adapter.name);
  assertValidSeries(bars, `${dataSourceId}:${symbol}`);
  if (bars.length === 0) {
    const account = emptyAccount(startingCash);
    return {
      strategy: strategy.name,
      symbol,
      dataSourceId,
      adapter: adapter.name,
      startingCash,
      equityCurve: [],
      fills: [],
      trades: [],
      rejections: [],
      killSwitchTrips: [],
      metrics: computeMetrics([], [], { commission: 0, financing: 0 }, periodsPerYear),
      finalAccount: account,
    };
  }

  let account = emptyAccount(startingCash);
  let killSwitch: KillSwitchState = openTradingDay(tradingDay(bars[0].time), startingCash);

  const equityCurve: EquityPoint[] = [];
  const fills: Fill[] = [];
  const trades: ClosedTrade[] = [];
  const rejections: RejectionRecord[] = [];
  const killSwitchTrips: { day: string; reason: string }[] = [];

  /** Orders queued on the previous bar, executing at this bar's open. The exit
   *  reason rides along so a flatten stays distinguishable from a strategy exit
   *  once it is recorded a bar later. */
  let pending: { order: Order; exitReason: ExitReason }[] = [];
  let orderSeq = 0;
  const nextOrderId = (): string => `${symbol}-${++orderSeq}`;

  const record = (order: Order, fill: Fill, exitReason: ExitReason): void => {
    const result = applyFill(account, order, fill, exitReason);
    account = result.account;
    fills.push(fill);
    if (result.closed) trades.push({ ...result.closed, setupTag: strategy.name });
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // 1. Queued orders execute at this bar's open.
    for (const { order, exitReason } of pending) {
      const fill = await adapter.submit(order, { bar });
      if (!fill) continue;
      record(order, fill, exitReason);
    }
    pending = [];

    // 2. Resting stops and targets, against this bar's range.
    const held = findPosition(account, symbol);
    if (held) {
      const exit = resolveExit(held, bar);
      if (exit) {
        const order = closingOrder(nextOrderId(), held, "rule");
        const fill = await adapter.submit(order, { bar, fillPrice: exit.price });
        if (fill) record(order, fill, exit.reason);
      }
    }

    // Financing on whatever survived the exits above, charged before equity is
    // marked so the cost shows up in the curve on the bar it was incurred.
    account = applyFinancing(account, { [symbol]: bar.close }, financingBpsPerBar);

    // 3. Mark to this bar's close and re-evaluate the daily-loss halt.
    const day = tradingDay(bar.time);
    if (day !== killSwitch.day) {
      killSwitch = openTradingDay(day, computeEquity(account, { [symbol]: bar.close }));
    }
    const equity = computeEquity(account, { [symbol]: bar.close });
    const evaluated = evaluateKillSwitch(killSwitch, equity, limits);
    const justTripped = evaluated.tripped && !killSwitch.tripped;
    killSwitch = evaluated;
    if (justTripped) {
      killSwitchTrips.push({ day: killSwitch.day, reason: killSwitch.reason ?? "halted" });
    }

    const isLastBar = i === bars.length - 1;

    if (justTripped && flattenOnKillSwitch) {
      const open = findPosition(account, symbol);
      // Flatten at the next open rather than this close — the halt is detected
      // on close data, so the earliest honest exit is the following bar.
      if (open && !isLastBar) {
        pending.push({ order: closingOrder(nextOrderId(), open, "rule"), exitReason: "kill_switch" });
      }
    } else if (!isLastBar && i + 1 >= strategy.warmupBars) {
      // 4. The strategy sees bars 0..i and nothing else.
      const visible = Object.freeze(bars.slice(0, i + 1));
      const signal = strategy.decide({
        symbol,
        bars: visible,
        position: findPosition(account, symbol),
        equity,
      });

      const decision = assessSignal(signal, {
        equity,
        cash: account.cash,
        referencePrice: bar.close,
        positions: account.positions,
        killSwitch,
        limits,
        orderId: nextOrderId(),
      });

      if (decision.approved) {
        pending.push({ order: decision.order, exitReason: "signal" });
      } else if (decision.reason !== "hold") {
        // "hold" would be one record per bar and says nothing; every other
        // rejection is a rule that actually bound.
        rejections.push({
          time: bar.time,
          symbol,
          action: signal.action,
          reason: decision.reason,
          detail: decision.detail,
        });
      }
    }

    // 5. Snapshot.
    equityCurve.push({ time: bar.time, equity, cash: account.cash });
  }

  // Anything still open at the end of the data is closed at the final close, so
  // the reported result contains no unresolved position.
  const stillOpen = findPosition(account, symbol);
  if (stillOpen) {
    const lastBar = bars[bars.length - 1];
    const order = closingOrder(nextOrderId(), stillOpen, "rule");
    const fill = await adapter.submit(order, { bar: lastBar, fillPrice: lastBar.close });
    if (fill) {
      record(order, fill, "end_of_data");
      const finalEquity = computeEquity(account, { [symbol]: lastBar.close });
      equityCurve[equityCurve.length - 1] = {
        time: lastBar.time,
        equity: finalEquity,
        cash: account.cash,
      };
    }
  }

  return {
    strategy: strategy.name,
    symbol,
    dataSourceId,
    adapter: adapter.name,
    startingCash,
    equityCurve,
    fills,
    trades,
    rejections,
    killSwitchTrips,
    metrics: computeMetrics(
      equityCurve,
      trades,
      { commission: account.commissionPaid, financing: account.financingPaid },
      periodsPerYear,
    ),
    finalAccount: account,
  };
}
