// Out-of-sample evaluation against pre-registered criteria.
//
// The rules this implements are fixed in EVIDENCE_PROTOCOL.md, which was
// committed before any backtest was run. Nothing here chooses a threshold; it
// only measures and compares. That separation is the whole point — a function
// that both runs the test and decides what passing means is not evidence.

import { maxDrawdown } from "./metrics";
import { roundCash } from "./money";
import type { BacktestResult } from "./backtest";
import type { Bar, EquityPoint } from "./types";

export type SplitResult = { inSample: Bar[]; outOfSample: Bar[] };

/** Bars strictly before `splitDate` are in-sample; the rest are not to be
 *  looked at until a configuration is frozen. */
export function splitBars(bars: Bar[], splitDate: string): SplitResult {
  const boundary = Date.parse(splitDate);
  return {
    inSample: bars.filter((b) => Date.parse(b.time) < boundary),
    outOfSample: bars.filter((b) => Date.parse(b.time) >= boundary),
  };
}

export type CostModel = {
  /** Paid on entry and again on exit. */
  halfSpreadBps: number;
  /** Charged per side. */
  commissionBps: number;
  /** Charged per bar on open notional. */
  financingBpsPerBar: number;
};

export type BaselineResult = {
  name: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  equityCurve: EquityPoint[];
  startingEquity: number;
  endingEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  totalCosts: number;
};

/**
 * Buy at the first bar's open, hold, sell at the last close — paying the same
 * spread, commission and financing the strategy pays.
 *
 * Deliberately not routed through the risk-managed engine: the baseline is
 * "what if you just bought the thing", and position-sizing it to 1% risk would
 * make it a different, weaker comparison that any strategy could beat.
 */
export function buyAndHold(bars: Bar[], startingCash: number, costs: CostModel): BaselineResult {
  if (bars.length < 2) {
    return {
      name: "buy-and-hold",
      quantity: 0,
      entryPrice: 0,
      exitPrice: 0,
      equityCurve: [],
      startingEquity: startingCash,
      endingEquity: startingCash,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      totalCosts: 0,
    };
  }

  const entryPrice = bars[0].open * (1 + costs.halfSpreadBps / 10_000);
  const quantity = Math.floor(startingCash / entryPrice);

  if (quantity < 1) {
    // Cannot afford one unit. Reported honestly rather than by pretending to
    // hold a fractional position the venue would not allow.
    const flat = bars.map((b) => ({ time: b.time, equity: startingCash, cash: startingCash }));
    return {
      name: "buy-and-hold",
      quantity: 0,
      entryPrice,
      exitPrice: entryPrice,
      equityCurve: flat,
      startingEquity: startingCash,
      endingEquity: startingCash,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      totalCosts: 0,
    };
  }

  const entryCommission = quantity * entryPrice * (costs.commissionBps / 10_000);
  let cash = startingCash - quantity * entryPrice - entryCommission;
  let totalCosts = entryCommission + quantity * bars[0].open * (costs.halfSpreadBps / 10_000);

  const equityCurve: EquityPoint[] = [];
  for (const bar of bars) {
    const financing = quantity * bar.close * (costs.financingBpsPerBar / 10_000);
    cash -= financing;
    totalCosts += financing;
    equityCurve.push({ time: bar.time, equity: roundCash(cash + quantity * bar.close), cash: roundCash(cash) });
  }

  const lastClose = bars[bars.length - 1].close;
  const exitPrice = lastClose * (1 - costs.halfSpreadBps / 10_000);
  const exitCommission = quantity * exitPrice * (costs.commissionBps / 10_000);
  totalCosts += exitCommission + quantity * lastClose * (costs.halfSpreadBps / 10_000);

  const endingEquity = roundCash(cash + quantity * exitPrice - exitCommission);
  equityCurve[equityCurve.length - 1] = {
    time: bars[bars.length - 1].time,
    equity: endingEquity,
    cash: endingEquity,
  };

  return {
    name: "buy-and-hold",
    quantity,
    entryPrice: roundCash(entryPrice),
    exitPrice: roundCash(exitPrice),
    equityCurve,
    startingEquity: startingCash,
    endingEquity,
    totalReturnPct: Number((((endingEquity - startingCash) / startingCash) * 100).toFixed(4)),
    maxDrawdownPct: Number(maxDrawdown(equityCurve).pct.toFixed(4)),
    totalCosts: roundCash(totalCosts),
  };
}

/** The six pre-registered criteria. Values come from EVIDENCE_PROTOCOL.md §7. */
export type Criteria = {
  minTrades: number;
  maxDrawdownPct: number;
  minProfitFactor: number;
  maxCostShareOfGrossProfitPct: number;
};

export const PREREGISTERED_CRITERIA: Criteria = {
  minTrades: 30,
  maxDrawdownPct: 20,
  minProfitFactor: 1.2,
  maxCostShareOfGrossProfitPct: 30,
};

export type CriterionResult = {
  id: number;
  name: string;
  observed: string;
  threshold: string;
  passed: boolean;
};

export type Evaluation = {
  passed: boolean;
  criteria: CriterionResult[];
  /** Net return if the single best trade had never happened. */
  returnWithoutBestTradePct: number;
};

export function evaluate(
  result: BacktestResult,
  baseline: BaselineResult,
  criteria: Criteria = PREREGISTERED_CRITERIA,
): Evaluation {
  const m = result.metrics;
  const trades = result.trades;

  // Gross profit BEFORE costs — the denominator for "is this paying for itself
  // or for the broker". Using net profit here would flatter the ratio exactly
  // when costs are worst.
  const grossProfit = trades.filter((t) => t.grossPnl > 0).reduce((sum, t) => sum + t.grossPnl, 0);
  const costShare = grossProfit > 0 ? (m.totalCosts / grossProfit) * 100 : Infinity;

  const bestTrade = trades.reduce((best, t) => (t.netPnl > (best?.netPnl ?? -Infinity) ? t : best), trades[0]);
  const netWithoutBest = trades.reduce((sum, t) => sum + t.netPnl, 0) - (bestTrade?.netPnl ?? 0);
  const returnWithoutBestTradePct =
    m.startingEquity > 0 ? Number(((netWithoutBest / m.startingEquity) * 100).toFixed(4)) : 0;

  const results: CriterionResult[] = [
    {
      id: 1,
      name: "Closed trades",
      observed: String(m.tradeCount),
      threshold: `>= ${criteria.minTrades}`,
      passed: m.tradeCount >= criteria.minTrades,
    },
    {
      id: 2,
      name: "Net return beats baseline",
      observed: `${m.totalReturnPct.toFixed(2)}% vs ${baseline.totalReturnPct.toFixed(2)}%`,
      threshold: "> baseline",
      passed: m.totalReturnPct > baseline.totalReturnPct,
    },
    {
      id: 3,
      name: "Max drawdown",
      observed: `${m.maxDrawdownPct.toFixed(2)}%`,
      threshold: `<= ${criteria.maxDrawdownPct}%`,
      passed: m.maxDrawdownPct <= criteria.maxDrawdownPct,
    },
    {
      id: 4,
      name: "Profit factor",
      observed: m.profitFactor === null ? "n/a" : m.profitFactor.toFixed(3),
      threshold: `>= ${criteria.minProfitFactor}`,
      passed: m.profitFactor !== null && m.profitFactor >= criteria.minProfitFactor,
    },
    {
      id: 5,
      name: "Costs as share of gross profit",
      observed: Number.isFinite(costShare) ? `${costShare.toFixed(1)}%` : "no gross profit",
      threshold: `<= ${criteria.maxCostShareOfGrossProfitPct}%`,
      passed: costShare <= criteria.maxCostShareOfGrossProfitPct,
    },
    {
      id: 6,
      name: "Survives removing its best trade",
      observed: `${returnWithoutBestTradePct.toFixed(2)}%`,
      threshold: "> 0%",
      passed: returnWithoutBestTradePct > 0,
    },
  ];

  return {
    // Every criterion must pass. No partial credit, per protocol §7.
    passed: results.every((r) => r.passed),
    criteria: results,
    returnWithoutBestTradePct,
  };
}
