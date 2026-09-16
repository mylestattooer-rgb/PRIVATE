// Multi-instrument portfolio backtest for time-series momentum.
//
// The one thing this file must get right is WHEN a weight starts earning.
// Weights are computed at the close of a rebalance bar using data through that
// bar, and they earn from the FOLLOWING bar. A single index slip here turns a
// mediocre strategy into a spectacular one, which is why the sequence below is
// written out explicitly and pinned by a test that feeds it a series only a
// look-ahead could profit from.
//
// Per bar, in order:
//   1. accrue the portfolio return using the weights held COMING INTO this bar
//   2. charge financing on the gross exposure carried through the bar
//   3. if this is a rebalance bar, compute new weights from data up to and
//      including it, and charge transaction costs on the turnover
//
// Step 1 before step 3 is the whole guarantee.
//
// Weights are EQUAL-WEIGHTED across instruments: each instrument's vol-scaled
// leverage is divided by the number of instruments in the universe. Without
// that division, a twelve-instrument basket each targeting 10% volatility runs
// at roughly twelve times the intended exposure — which is exactly what the
// first run of this study did, at 11x gross and a 522% cost drag. The financing
// model is what made it obvious; a backtest without one would have reported a
// plausible-looking loss and hidden the cause.

import { realisedVol, simpleReturns, trailingReturn, type AlignedSeries } from "./series";
import { momentumSignal, volScaledWeight, warmupBars, type SignalMode, type TsmomConfig } from "./tsmom";

export type PortfolioCosts = {
  /** Charged on absolute weight change at each rebalance. */
  transactionBps: number;
  /** Charged per bar on gross exposure. */
  financingBpsPerBar: number;
};

export const FREE: PortfolioCosts = { transactionBps: 0, financingBpsPerBar: 0 };

export type PortfolioResult = {
  /** Dates on which a return accrued (one per bar after the first). */
  dates: string[];
  /** Portfolio returns net of all costs. */
  returns: number[];
  returnsGross: number[];
  /** Cumulative contribution of each instrument, GROSS of costs. Costs are
   *  charged at the portfolio level (financing on total gross exposure,
   *  transaction cost on total turnover) and are not attributable to one
   *  instrument without an arbitrary allocation rule, so they are not
   *  attributed at all. Any criterion counting "positive instruments" is
   *  therefore counting them before costs, and must say so. */
  contributionBySymbol: Record<string, number>;
  /** Each instrument's contribution stream, for correlation and breadth. */
  contributionSeries: Record<string, number[]>;
  rebalanceCount: number;
  /** Mean absolute weight change per rebalance, summed across instruments. */
  meanTurnover: number;
  meanGrossExposure: number;
  maxGrossExposure: number;
  /** How often the per-instrument weight cap bound. High means the vol target
   *  was not actually achieved and the result is really a fixed-weight bet. */
  capBindRate: number;
  totalCostDrag: number;
};

export type RunOptions = {
  config: TsmomConfig;
  costs: PortfolioCosts;
  signalMode: SignalMode;
  /** Restrict to a subset of the universe — used for the leave-one-out test. */
  symbols?: string[];
  /** Inclusive date bounds. */
  from?: string;
  to?: string;
};

export function runPortfolio(aligned: AlignedSeries, options: RunOptions): PortfolioResult {
  const { config, costs, signalMode } = options;
  const symbols = options.symbols ?? aligned.symbols;

  const returnsBySymbol: Record<string, (number | null)[]> = {};
  for (const symbol of symbols) returnsBySymbol[symbol] = simpleReturns(aligned.prices[symbol]);

  const warmup = warmupBars(config);
  const fromIndex = options.from ? aligned.dates.findIndex((d) => d >= options.from!) : 0;
  const toIndex = options.to
    ? aligned.dates.reduce((last, d, i) => (d <= options.to! ? i : last), 0)
    : aligned.dates.length - 1;

  const start = Math.max(warmup, fromIndex < 0 ? warmup : fromIndex);

  let weights: Record<string, number> = Object.fromEntries(symbols.map((s) => [s, 0]));
  const dates: string[] = [];
  const returns: number[] = [];
  const returnsGross: number[] = [];
  const contributionSeries: Record<string, number[]> = Object.fromEntries(symbols.map((s) => [s, []]));

  let rebalanceCount = 0;
  let turnoverTotal = 0;
  let grossTotal = 0;
  let maxGross = 0;
  let capBinds = 0;
  let capChecks = 0;
  let costDrag = 0;

  for (let i = start; i <= toIndex; i++) {
    // ---- 1. accrue on the weights held coming into this bar ----
    let gross = 0;
    let barReturn = 0;
    for (const symbol of symbols) {
      const weight = weights[symbol];
      gross += Math.abs(weight);
      const r = returnsBySymbol[symbol][i];
      const contribution = weight !== 0 && r !== null ? weight * r : 0;
      barReturn += contribution;
      contributionSeries[symbol].push(contribution);
    }

    const grossReturn = barReturn;

    // ---- 2. financing on gross exposure carried through the bar ----
    const financing = gross * (costs.financingBpsPerBar / 10_000);
    let netReturn = barReturn - financing;
    costDrag += financing;

    grossTotal += gross;
    maxGross = Math.max(maxGross, gross);

    // ---- 3. rebalance, using data through this bar only ----
    const isRebalance = (i - start) % config.rebalanceEvery === 0;
    if (isRebalance) {
      const next: Record<string, number> = {};
      // Equal-weight across the universe. See the note at the top of this file.
      const allocation = 1 / symbols.length;
      for (const symbol of symbols) {
        const trailing = trailingReturn(aligned.prices[symbol], config.lookback, i);
        const signal = signalMode === "long-only" ? (trailing === null ? null : 1) : momentumSignal(trailing);
        const vol = realisedVol(returnsBySymbol[symbol], config.volWindow, i, config.periodsPerYear);
        const { weight, capped } = volScaledWeight(signal, vol, config);
        if (signal !== null && vol !== null) {
          capChecks++;
          if (capped) capBinds++;
        }
        next[symbol] = weight * allocation;
      }

      const turnover = symbols.reduce((sum, s) => sum + Math.abs(next[s] - weights[s]), 0);
      const transactionCost = turnover * (costs.transactionBps / 10_000);
      netReturn -= transactionCost;
      costDrag += transactionCost;

      turnoverTotal += turnover;
      rebalanceCount++;
      weights = next;
    }

    dates.push(aligned.dates[i]);
    returns.push(netReturn);
    returnsGross.push(grossReturn);
  }

  const contributionBySymbol = Object.fromEntries(
    symbols.map((s) => [s, contributionSeries[s].reduce((a, b) => a + b, 0)]),
  );

  return {
    dates,
    returns,
    returnsGross,
    contributionBySymbol,
    contributionSeries,
    rebalanceCount,
    meanTurnover: rebalanceCount > 0 ? turnoverTotal / rebalanceCount : 0,
    meanGrossExposure: returns.length > 0 ? grossTotal / returns.length : 0,
    maxGrossExposure: maxGross,
    capBindRate: capChecks > 0 ? capBinds / capChecks : 0,
    totalCostDrag: costDrag,
  };
}
