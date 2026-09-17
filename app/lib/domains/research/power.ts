// Statistical power: can this data detect the edge it would need to find?
//
// The question that belongs before a hypothesis, not after it. A study without
// enough observations to distinguish a real edge from noise does not return
// "no edge" — it returns a number with no information in it, which is then
// argued about. Computing the answer first turns "we found nothing" into
// either "there is nothing here" or "this data could never have told us",
// which are completely different results.
//
// It is also the one guard against the failure mode these studies are most
// exposed to. An underpowered test that happens to land above its threshold is
// the single most likely way a false positive gets promoted to live trading,
// and the smaller the sample the more often that happens.

/** Normal quantile, Acklam's rational approximation. Accurate to ~1e-9. */
function probit(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export type PowerSpec = {
  /** The rate that must be beaten — here, the break-even hit rate. */
  baseline: number;
  /** The true rate to be detected, above `baseline`. */
  target: number;
  /** One-sided false-positive rate. Default 0.05. */
  alpha?: number;
  /** Probability of detecting the effect when it is real. Default 0.8. */
  power?: number;
};

/**
 * Independent observations needed to distinguish `target` from `baseline`.
 *
 * One-sided, because the only interesting alternative is beating break-even:
 * a strategy significantly WORSE than break-even is not a finding anyone would
 * act on, and spending half the error budget guarding against it wastes
 * sample. Stated explicitly because a one-sided test chosen after seeing the
 * data is a way to manufacture significance; this one is fixed in advance and
 * in code.
 *
 * Standard normal approximation for a one-sample proportion.
 */
export function requiredSamples(spec: PowerSpec): number {
  const { baseline, target } = spec;
  const alpha = spec.alpha ?? 0.05;
  const power = spec.power ?? 0.8;
  const delta = target - baseline;
  if (delta <= 0) return Number.POSITIVE_INFINITY;

  const zAlpha = probit(1 - alpha);
  const zBeta = probit(power);
  const numerator = zAlpha * Math.sqrt(baseline * (1 - baseline)) + zBeta * Math.sqrt(target * (1 - target));
  return Math.ceil((numerator * numerator) / (delta * delta));
}

/**
 * The smallest edge `samples` observations can detect — the inverse of the
 * above, solved numerically since the closed form is implicit in `target`.
 *
 * This is the number that should be read first. If it exceeds the edge anyone
 * plausibly claims for the strategy, the study cannot succeed and should not
 * be run.
 */
export function detectableEdge(samples: number, baseline: number, alpha = 0.05, power = 0.8): number {
  if (samples <= 0) return Number.POSITIVE_INFINITY;
  let lo = 0;
  let hi = 1 - baseline;
  if (hi <= 0) return Number.POSITIVE_INFINITY;

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (requiredSamples({ baseline, target: baseline + mid, alpha, power }) <= samples) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Non-overlapping observations available from `bars` bars at `horizon`.
 *
 * Overlapping windows are fine for estimating how far price typically travels
 * and are NOT independent observations. Using the overlapping count in a power
 * calculation inflates the sample by the horizon length — a 15-minute horizon
 * would claim fifteen times the information it holds, which is precisely the
 * arithmetic that makes an underpowered study look adequate.
 */
export function independentSamples(bars: number, horizon: number): number {
  if (bars <= 0 || horizon <= 0) return 0;
  return Math.floor(bars / horizon);
}
