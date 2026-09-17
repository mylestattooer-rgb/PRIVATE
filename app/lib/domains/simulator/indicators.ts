// Pure indicator maths. Each function reads the TRAILING window of the series
// it is given and returns null when there is not enough history, rather than
// quietly averaging a short window — a 200-period average computed from 12 bars
// is not a 200-period average, and silently returning one is how a backtest
// starts lying in its first few bars.

import type { Bar } from "./types";

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(values.length - period);
  return window.reduce((a, b) => a + b, 0) / period;
}

export function trueRange(bar: Bar, previousClose: number | null): number {
  const highLow = bar.high - bar.low;
  if (previousClose === null) return highLow;
  return Math.max(highLow, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

/** Simple (not Wilder-smoothed) average true range over the trailing window.
 *  Needs period + 1 bars, since the first true range requires a previous close. */
export function atr(bars: Bar[], period: number): number | null {
  if (period <= 0 || bars.length < period + 1) return null;

  const ranges: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    ranges.push(trueRange(bars[i], bars[i - 1].close));
  }
  return ranges.reduce((a, b) => a + b, 0) / period;
}

/** True when `fast` finished at or below `slow` on the previous bar and strictly
 *  above it on the current one. Strict on the current bar so a flat, equal pair
 *  does not fire a cross every bar. */
export function crossedAbove(
  fastNow: number,
  slowNow: number,
  fastPrev: number,
  slowPrev: number,
): boolean {
  return fastPrev <= slowPrev && fastNow > slowNow;
}

export function crossedBelow(
  fastNow: number,
  slowNow: number,
  fastPrev: number,
  slowPrev: number,
): boolean {
  return fastPrev >= slowPrev && fastNow < slowNow;
}
