// A worked example of the Strategy interface — deliberately a textbook moving
// average crossover, not a claim about anything.
//
// It exists to prove the harness end to end with a strategy whose behaviour is
// completely obvious from the source, so a surprising backtest result points at
// the engine rather than at the strategy. Treat it as a fixture.

import { atr, crossedAbove, crossedBelow, sma } from "../indicators";
import { holdSignal } from "../signal";
import type { Strategy, StrategyContext } from "../backtest";
import type { Signal } from "../types";

export type SmaCrossoverConfig = {
  fastPeriod: number;
  slowPeriod: number;
  atrPeriod: number;
  /** Stop distance, in ATRs below (long) the entry price. */
  atrStopMultiple: number;
  /** Target distance as a multiple of the stop distance. 0 leaves the trade
   *  with no target, exiting on the opposite cross instead. */
  rewardToRisk: number;
  /** Rule strategies have no probability estimate to offer — "confidence" is an
   *  AI-signal concept (see signal.ts). A constant above the Risk Manager's
   *  floor keeps deterministic signals from being silently filtered, and is
   *  honest about carrying no information. */
  entryConfidence: number;
};

export const DEFAULT_SMA_CONFIG: SmaCrossoverConfig = {
  fastPeriod: 10,
  slowPeriod: 30,
  atrPeriod: 14,
  atrStopMultiple: 2,
  rewardToRisk: 2,
  entryConfidence: 0.7,
};

export function createSmaCrossoverStrategy(
  overrides: Partial<SmaCrossoverConfig> = {},
): Strategy {
  const config = { ...DEFAULT_SMA_CONFIG, ...overrides };
  const { fastPeriod, slowPeriod, atrPeriod, atrStopMultiple, rewardToRisk, entryConfidence } = config;

  // +1 on each: the crossover test needs the previous bar's averages, and ATR
  // needs one bar of history before its own window.
  const warmupBars = Math.max(slowPeriod, atrPeriod + 1) + 1;

  return {
    name: `sma-${fastPeriod}/${slowPeriod}`,
    warmupBars,

    decide(ctx: StrategyContext): Signal {
      const bars = ctx.bars;
      const closes = bars.map((b) => b.close);

      const fastNow = sma(closes, fastPeriod);
      const slowNow = sma(closes, slowPeriod);
      const fastPrev = sma(closes.slice(0, -1), fastPeriod);
      const slowPrev = sma(closes.slice(0, -1), slowPeriod);

      if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) {
        return holdSignal(ctx.symbol, "not enough history for both averages");
      }

      if (ctx.position) {
        return crossedBelow(fastNow, slowNow, fastPrev, slowPrev)
          ? {
              symbol: ctx.symbol,
              action: "exit",
              confidence: entryConfidence,
              stopPrice: null,
              targetPrice: null,
              rationale: `fast ${fastPeriod} crossed below slow ${slowPeriod}`,
              source: "rule",
            }
          : holdSignal(ctx.symbol, "position open, no opposite cross");
      }

      if (!crossedAbove(fastNow, slowNow, fastPrev, slowPrev)) {
        return holdSignal(ctx.symbol, "no upward cross on this bar");
      }

      const volatility = atr([...bars], atrPeriod);
      if (volatility === null || volatility <= 0) {
        return holdSignal(ctx.symbol, "no usable ATR for stop placement");
      }

      const price = bars[bars.length - 1].close;
      const stopDistance = volatility * atrStopMultiple;
      const stopPrice = price - stopDistance;

      // A stop at or below zero means the instrument is more volatile than it
      // is priced; refuse rather than emit a nonsensical stop for risk.ts to
      // reject downstream.
      if (stopPrice <= 0) return holdSignal(ctx.symbol, "ATR stop would fall at or below zero");

      return {
        symbol: ctx.symbol,
        action: "enter_long",
        confidence: entryConfidence,
        stopPrice,
        targetPrice: rewardToRisk > 0 ? price + stopDistance * rewardToRisk : null,
        rationale: `fast ${fastPeriod} crossed above slow ${slowPeriod}; stop ${atrStopMultiple} ATR below`,
        source: "rule",
      };
    },
  };
}
