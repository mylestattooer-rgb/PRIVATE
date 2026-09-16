// Rounding helpers. Cash is tracked as a plain float, which is fine for a
// simulator (values are small and every figure is recomputed from fills rather
// than accumulated blindly), but rounding at the boundaries keeps reported
// numbers from drifting into 0.30000000000000004 territory.
//
// A live-money version of this domain would use integer minor units instead.
// Flagged here rather than in a doc so the next person hits it in the code.

export function roundCash(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPrice(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
