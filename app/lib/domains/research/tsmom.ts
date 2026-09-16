// Time-series momentum, specified exactly as EVIDENCE_PROTOCOL_2.md §4 fixes it.
//
// Two decisions per instrument per rebalance, and nothing else:
//   direction — the sign of the trailing 12-month return
//   size      — whatever makes this instrument contribute the target volatility
//
// There is no threshold, no confirmation filter, no regime switch and no
// parameter that was chosen by looking at a result. That austerity is the
// design: every knob added is another chance to fit noise, and the published
// effect does not need any of them.

export type TsmomConfig = {
  /** Trailing window whose return sign gives the direction. */
  lookback: number;
  /** Window for the realised volatility estimate used to size. */
  volWindow: number;
  /** Target annualised volatility contribution per instrument. */
  volTargetAnnual: number;
  /** Bars between rebalances. */
  rebalanceEvery: number;
  /** Hard ceiling on one instrument's leverage BEFORE the 1/N portfolio
   *  normalisation. A risk constraint, not a tuned parameter: without it, a
   *  low-volatility estimate produces arbitrary leverage, and no real account
   *  would permit that. How often it binds is reported, because a cap that binds
   *  constantly means the vol target is fiction. */
  maxWeightPerInstrument: number;
  periodsPerYear: number;
};

/** The canonical published specification. Fixed before any test was run. */
export const CANONICAL_TSMOM: TsmomConfig = {
  lookback: 252,
  volWindow: 60,
  volTargetAnnual: 0.1,
  rebalanceEvery: 21,
  maxWeightPerInstrument: 2,
  periodsPerYear: 252,
};

export type SignalMode = "momentum" | "long-only";

/** +1, -1, or null when there is not enough history. Never 0: a flat trailing
 *  return is vanishingly rare and treating it as a third state would add an
 *  unspecified rule. */
export function momentumSignal(trailing: number | null): 1 | -1 | null {
  if (trailing === null || !Number.isFinite(trailing)) return null;
  return trailing >= 0 ? 1 : -1;
}

/**
 * Leverage that makes this instrument contribute `volTargetAnnual` of
 * volatility, signed by the direction and capped.
 *
 * This is the PRE-NORMALISATION figure. The portfolio divides by the number of
 * instruments before allocating — see portfolio.ts. Summing per-instrument vol
 * targets without that division is a specification error that produced 11x
 * gross exposure on a supposed 10% vol target in the first run of this study;
 * it is recorded in EVIDENCE_RESULTS_2.md rather than quietly corrected.
 *
 * Returns 0 when volatility is unknown or zero — an instrument whose risk
 * cannot be measured gets no capital, rather than a default size.
 */
export function volScaledWeight(
  signal: 1 | -1 | null,
  annualVol: number | null,
  config: TsmomConfig,
): { weight: number; capped: boolean } {
  if (signal === null || annualVol === null || !Number.isFinite(annualVol) || annualVol <= 0) {
    return { weight: 0, capped: false };
  }

  const unconstrained = config.volTargetAnnual / annualVol;
  const capped = unconstrained > config.maxWeightPerInstrument;
  const magnitude = Math.min(unconstrained, config.maxWeightPerInstrument);
  return { weight: signal * magnitude, capped };
}

export function warmupBars(config: TsmomConfig): number {
  return Math.max(config.lookback, config.volWindow + 1);
}
