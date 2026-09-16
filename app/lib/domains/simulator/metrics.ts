// Backtest result metrics. Plain arithmetic over the equity curve and the list
// of closed trades — the AI never computes any of these (AI_ARCHITECTURE.md's
// determinism boundary); at most it gets to comment on them afterwards.
//
// Win rate, average R and setup/mistake breakdowns are deliberately NOT
// reimplemented here: simulator trades are shaped to match the journal domain's
// `StatTrade`, so `computeJournalStats` does that work and a student sees the
// same numbers computed the same way whether a trade was manual or simulated.

import { computeJournalStats, type JournalStats } from "../journal/stats";
import { roundCash } from "./money";
import type { ClosedTrade, EquityPoint } from "./types";

export type BacktestMetrics = {
  startingEquity: number;
  endingEquity: number;
  totalReturnPct: number;
  /** Largest peak-to-trough decline in the equity curve, as a positive percent. */
  maxDrawdownPct: number;
  maxDrawdownAmount: number;
  /** Gross profit ÷ gross loss. null when there were no losing trades — an
   *  "infinite" profit factor is a sample-size artefact, not a result. */
  profitFactor: number | null;
  /** Annualized, zero risk-free rate, from per-bar returns. A rough comparator
   *  between runs on the same data, not a number to quote anywhere. */
  sharpe: number | null;
  barCount: number;
  tradeCount: number;
  commissionPaid: number;
  journal: JournalStats;
};

export function maxDrawdown(curve: EquityPoint[]): { pct: number; amount: number } {
  let peak = -Infinity;
  let worstPct = 0;
  let worstAmount = 0;

  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    if (peak <= 0) continue;
    const amount = peak - point.equity;
    const pct = (amount / peak) * 100;
    if (pct > worstPct) {
      worstPct = pct;
      worstAmount = amount;
    }
  }

  return { pct: worstPct, amount: roundCash(worstAmount) };
}

export function profitFactor(trades: ClosedTrade[]): number | null {
  const grossWin = trades.filter((t) => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = trades.filter((t) => t.netPnl < 0).reduce((s, t) => s - t.netPnl, 0);
  if (grossLoss === 0) return null;
  return Number((grossWin / grossLoss).toFixed(4));
}

/** Annualized Sharpe from per-bar simple returns, sample standard deviation. */
export function sharpeRatio(curve: EquityPoint[], periodsPerYear = 252): number | null {
  if (curve.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    if (prev <= 0) return null;
    returns.push((curve[i].equity - prev) / prev);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;

  return Number(((mean / stdDev) * Math.sqrt(periodsPerYear)).toFixed(4));
}

export function computeMetrics(
  curve: EquityPoint[],
  trades: ClosedTrade[],
  commissionPaid: number,
  periodsPerYear = 252,
): BacktestMetrics {
  const startingEquity = curve[0]?.equity ?? 0;
  const endingEquity = curve[curve.length - 1]?.equity ?? startingEquity;
  const drawdown = maxDrawdown(curve);

  return {
    startingEquity: roundCash(startingEquity),
    endingEquity: roundCash(endingEquity),
    totalReturnPct:
      startingEquity > 0 ? Number((((endingEquity - startingEquity) / startingEquity) * 100).toFixed(4)) : 0,
    maxDrawdownPct: Number(drawdown.pct.toFixed(4)),
    maxDrawdownAmount: drawdown.amount,
    profitFactor: profitFactor(trades),
    sharpe: sharpeRatio(curve, periodsPerYear),
    barCount: curve.length,
    tradeCount: trades.length,
    commissionPaid: roundCash(commissionPaid),
    journal: computeJournalStats(trades),
  };
}
