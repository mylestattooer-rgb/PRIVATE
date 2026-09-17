// Reversion measurement — the analysis behind hypothesis 3, extracted from the
// script so it can be tested against series whose answer is known in advance.
//
// It lived inline in scripts/study3.ts and produced a 4.3-sigma headline
// number with nothing verifying it. Every other calculation in this repo is
// pinned by tests; the one that generated a publishable result was not. An
// adversarial review of that result found no error in it, which is precisely
// when the tests should be written — while the answer is not yet in doubt —
// rather than after something has gone wrong.

import type { Mt5Bar } from "./mt5-import";

export type Observation = {
  /** Index of the decision bar in the source series. */
  index: number;
  /** Epoch milliseconds of the decision bar. */
  time: number;
  hour: number;
  /** Signed return over the `horizon` bars INTO the decision bar, in bps. */
  triggerBps: number;
  /** Signed return over the `horizon` bars AFTER it, in bps. */
  forwardBps: number;
  /**
   * Causal median of `abs(triggerBps)` over the trailing window — computed
   * from observations strictly earlier than this one. NaN until the window
   * holds `minTrailing` of them.
   */
  trailingMedian: number;
};

export type BuildOptions = {
  /** Bars per observation. Observations step by this, so forward windows never overlap. */
  horizon: number;
  /** Minutes of history the trailing median is taken over. */
  trailingMinutes: number;
  /** Observations required before a trailing median is reported. */
  minTrailing?: number;
};

/**
 * Turn a minute series into non-overlapping observations.
 *
 * Stepping by `horizon` rather than by 1 is what makes forward windows
 * disjoint. Consecutive observations do share a bar — observation `i + h`'s
 * trigger return is observation `i`'s forward return — but the returns being
 * measured do not overlap, and the lag-1 autocorrelation of the resulting hit
 * indicator was measured at −0.016 on real data, so treating them as
 * independent is sound.
 *
 * Windows straddling a session gap are dropped by requiring both the trigger
 * and forward windows to span exactly `horizon` minutes. That removes the
 * weekend jump without a holiday calendar.
 */
export function buildObservations(bars: Mt5Bar[], options: BuildOptions): Observation[] {
  const { horizon, trailingMinutes } = options;
  const minTrailing = options.minTrailing ?? 20;
  if (horizon <= 0 || bars.length <= horizon * 2) return [];

  const times = bars.map((b) => Date.parse(b.time));
  const closes = bars.map((b) => b.close);
  const step = horizon * 60_000;
  const out: Observation[] = [];

  for (let i = horizon; i + horizon < bars.length; i += horizon) {
    if (times[i] - times[i - horizon] !== step) continue;
    if (times[i + horizon] - times[i] !== step) continue;
    if (closes[i - horizon] <= 0 || closes[i] <= 0) continue;

    const triggerBps = (closes[i] / closes[i - horizon] - 1) * 10_000;
    const forwardBps = (closes[i + horizon] / closes[i] - 1) * 10_000;

    // Strictly earlier observations only. Using the whole sample's median here
    // is look-ahead, and it flatters the result: measured on the real gold
    // series it scored 0.15 points higher than the causal version.
    const cutoff = times[i] - trailingMinutes * 60_000;
    const prior: number[] = [];
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j].time < cutoff) break;
      prior.push(Math.abs(out[j].triggerBps));
    }
    prior.sort((a, b) => a - b);

    out.push({
      index: i,
      time: times[i],
      hour: new Date(times[i]).getUTCHours(),
      triggerBps,
      forwardBps,
      trailingMedian: prior.length >= minTrailing ? prior[Math.floor(prior.length / 2)] : NaN,
    });
  }
  return out;
}

export type HitRate = {
  hits: number;
  misses: number;
  /** Forward returns of exactly zero: neither direction, and a loss after cost. */
  flats: number;
  /** Hits over decided outcomes. NaN when nothing was decided. */
  rate: number;
  /** Hits over all observations, counting flats as losses. */
  rateWithFlats: number;
  /** Standard error of `rate` under independence. */
  standardError: number;
};

/** A reversion call: short after an up-move, long after a down-move. */
export function isReversal(o: Observation): boolean {
  return Math.sign(o.forwardBps) !== Math.sign(o.triggerBps);
}

export function hitRate(observations: Observation[]): HitRate {
  let hits = 0;
  let misses = 0;
  let flats = 0;
  for (const o of observations) {
    if (o.forwardBps === 0) flats++;
    else if (isReversal(o)) hits++;
    else misses++;
  }
  const decided = hits + misses;
  return {
    hits,
    misses,
    flats,
    rate: decided > 0 ? hits / decided : NaN,
    rateWithFlats: observations.length > 0 ? hits / observations.length : NaN,
    standardError: decided > 0 ? Math.sqrt(0.25 / decided) : NaN,
  };
}

/**
 * Gross basis points captured per observation, before cost.
 *
 * Credits the full forward move on a correct call and debits it on a wrong
 * one. Generous on both sides — a real exit rule captures less — which is why
 * a negative result here is conclusive and a positive one is not.
 */
export function grossBps(observations: Observation[]): number {
  return observations.reduce((sum, o) => sum + (isReversal(o) ? 1 : -1) * Math.abs(o.forwardBps), 0);
}
