// Intraday feasibility: what a strategy would have to achieve to pay for
// itself, hour by hour.
//
// This module deliberately measures NO returns and proposes NO strategy. It
// answers a narrower question that has to be settled first, because the answer
// closes off most of the search space before any hypothesis is written:
//
//   Given this broker's real spread at this hour, and how far this instrument
//   actually moves over this horizon, what directional hit rate would a
//   strategy need just to break even?
//
// That framing matters. "Spread is 0.3 bps" is not actionable — it is only
// meaningful against the size of the move you are trying to capture. The same
// 0.3 bps is negligible against a 25 bps hourly move and fatal against a 0.3
// bps one. Expressing it as a required hit rate puts the cost on the same
// scale as the only thing a signal can deliver, and that scale has a hard
// ceiling at 100%.
//
// **Necessary, not sufficient.** A cell that needs 52% says a strategy is not
// arithmetically excluded there. It says nothing whatever about whether any
// signal reaches 52%. The two hypotheses tested so far reached 48.3% and
// roughly a coin flip, so most cells that clear this screen will still fail.
// The screen's value is the cells it CLOSES: where the required rate exceeds
// 100%, no signal of any quality can pay for the spread, and no hypothesis
// aimed there is worth writing.

import type { Mt5Bar } from "./mt5-import";
import { spreadPointsToBps } from "./mt5-import";

/** Minutes ahead that a decision at bar `i` is evaluated over. */
export type Horizon = number;

export type HorizonStat = {
  horizon: Horizon;
  /** Windows contributing, after discarding any that straddle a session gap. */
  samples: number;
  /**
   * Mean absolute forward return in bps.
   *
   * The MEAN, not the median, because expected P&L is additive: under the
   * assumption that being right is independent of how far price travels,
   * E[pnl] = meanAbsMove * (2p - 1) - spread, which is what `breakEvenHitRate`
   * inverts. The median is carried alongside because on a fat-tailed series
   * the two diverge, and a large gap is itself a warning that the mean is
   * being set by a handful of minutes a strategy would not reliably catch.
   */
  meanAbsMoveBps: number;
  medianAbsMoveBps: number;
};

export type HourProfile = {
  /** Hour of the day, UTC. */
  hour: number;
  bars: number;
  /** Bars whose spread cell reported a positive value. */
  spreadSamples: number;
  /**
   * Share of bars in this hour with no usable spread, 0..1.
   *
   * Not cosmetic. On the operator's own exports the missing bars have a WIDER
   * high-low range than the reporting ones, so whatever suppresses the reading
   * is correlated with volatility. That means the median below is taken over
   * the calmer half of the hour and, if anything, UNDERSTATES the true cost —
   * biased in the flattering direction. Above roughly 0.4 the hour's figures
   * describe the bars that happened to report and little more.
   */
  missingSpreadShare: number;
  /** Median round-trip spread in bps, over the bars that reported one. */
  medianSpreadBps: number;
  p95SpreadBps: number;
  horizons: HorizonStat[];
};

export type Feasibility = "impossible" | "implausible" | "demanding" | "affordable";

/**
 * The directional hit rate at which expected P&L crosses zero.
 *
 * Win the full move when right, lose it when wrong, pay the round-trip spread
 * either way:  E[pnl] = m(2p - 1) - s  =>  p = 0.5 + s / 2m.
 *
 * Returns Infinity when the instrument does not move at all over the horizon,
 * and a value above 1 whenever the spread exceeds the typical move — which is
 * not a near miss but an arithmetic impossibility, since p is a probability.
 */
export function breakEvenHitRate(spreadBps: number, meanAbsMoveBps: number): number {
  if (meanAbsMoveBps <= 0) return Number.POSITIVE_INFINITY;
  return 0.5 + spreadBps / (2 * meanAbsMoveBps);
}

/**
 * Bucket a required hit rate by whether anything could plausibly reach it.
 *
 * The thresholds are judgements and are stated rather than buried:
 *
 *   impossible  > 100%  — arithmetic, not opinion. The spread exceeds the move.
 *   implausible >  55%  — beyond what published work sustains net of costs on
 *                         liquid instruments. Treated as closed.
 *   demanding   >  52%  — the only band worth writing a hypothesis for, and
 *                         still harder than either hypothesis tested here got.
 *   affordable  <= 52%  — cost is small against the move; the question becomes
 *                         entirely whether a signal exists.
 */
export function classify(requiredHitRate: number): Feasibility {
  if (!Number.isFinite(requiredHitRate) || requiredHitRate > 1) return "impossible";
  if (requiredHitRate > 0.55) return "implausible";
  if (requiredHitRate > 0.52) return "demanding";
  return "affordable";
}

/**
 * Forward absolute returns over `horizon` minutes, keyed by the UTC hour the
 * decision would have been taken in.
 *
 * Windows straddling a session gap are discarded rather than measured: the
 * weekend jump is not something a minute-horizon strategy can trade, and
 * including it would inflate exactly the hours around the close, which are
 * also the hours where the spread is worst. Requiring the window to be exactly
 * `horizon` minutes wide enforces this without a special case for holidays.
 *
 * Windows overlap, so `samples` counts observations rather than independent
 * ones. That is sound for estimating the size of a typical move — the quantity
 * wanted here — and would not be sound for a significance test, which this
 * deliberately is not.
 */
function forwardMovesByHour(bars: Mt5Bar[], horizon: number): Map<number, number[]> {
  const byHour = new Map<number, number[]>();
  const times = bars.map((b) => Date.parse(b.time));
  const wanted = horizon * 60_000;

  for (let i = 0; i + horizon < bars.length; i++) {
    if (times[i + horizon] - times[i] !== wanted) continue;
    const from = bars[i].close;
    if (from <= 0) continue;
    const move = Math.abs(bars[i + horizon].close / from - 1) * 10_000;
    const hour = new Date(times[i]).getUTCHours();
    const bucket = byHour.get(hour);
    if (bucket) bucket.push(move);
    else byHour.set(hour, [move]);
  }
  return byHour;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * Build the hour-by-hour cost and movement profile.
 *
 * `pointSize` is the instrument's price increment, from the symbol
 * specification — 0.01 for gold at two decimals, 0.00001 for a 5-digit FX
 * pair. Spread is converted at each bar's own close rather than at a single
 * reference price, so a series spanning a large price move is not distorted.
 */
export function hourlyProfile(
  bars: Mt5Bar[],
  pointSize: number,
  horizons: Horizon[] = [1, 5, 15, 60],
): HourProfile[] {
  if (bars.length === 0 || pointSize <= 0) return [];

  const ordered = [...bars].sort((a, b) => a.time.localeCompare(b.time));
  const spreadsByHour = new Map<number, number[]>();
  const countByHour = new Map<number, number>();

  for (const bar of ordered) {
    const hour = new Date(Date.parse(bar.time)).getUTCHours();
    countByHour.set(hour, (countByHour.get(hour) ?? 0) + 1);
    if (bar.spreadPoints === null || bar.spreadPoints <= 0) continue;
    const bps = spreadPointsToBps(bar.spreadPoints, pointSize, bar.close);
    const bucket = spreadsByHour.get(hour);
    if (bucket) bucket.push(bps);
    else spreadsByHour.set(hour, [bps]);
  }

  const movesByHorizon = new Map(horizons.map((h) => [h, forwardMovesByHour(ordered, h)]));

  return [...countByHour.keys()]
    .sort((a, b) => a - b)
    .map((hour) => {
      const spreads = (spreadsByHour.get(hour) ?? []).sort((a, b) => a - b);
      const bars = countByHour.get(hour) ?? 0;

      return {
        hour,
        bars,
        spreadSamples: spreads.length,
        missingSpreadShare: bars > 0 ? (bars - spreads.length) / bars : 1,
        medianSpreadBps: quantile(spreads, 0.5),
        p95SpreadBps: quantile(spreads, 0.95),
        horizons: horizons.map((horizon) => {
          const moves = (movesByHorizon.get(horizon)?.get(hour) ?? []).sort((a, b) => a - b);
          return {
            horizon,
            samples: moves.length,
            meanAbsMoveBps: moves.length > 0 ? moves.reduce((a, b) => a + b, 0) / moves.length : 0,
            medianAbsMoveBps: quantile(moves, 0.5),
          };
        }),
      };
    });
}
