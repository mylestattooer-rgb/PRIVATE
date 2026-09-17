// Portfolio statistics. Plain arithmetic, no fitting, no opinions.

export function annualisedReturn(returns: number[], periodsPerYear: number): number {
  if (returns.length === 0) return 0;
  // Geometric, so it matches what the equity curve actually did rather than
  // the arithmetic mean, which overstates any volatile series.
  const growth = returns.reduce((acc, r) => acc * (1 + r), 1);
  if (growth <= 0) return -1;
  return growth ** (periodsPerYear / returns.length) - 1;
}

export function annualisedVol(returns: number[], periodsPerYear: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/** Zero risk-free rate. Stated rather than hidden: in a period with meaningful
 *  cash rates this overstates the ratio, and 2022-2024 is such a period. */
export function sharpe(returns: number[], periodsPerYear: number): number | null {
  const vol = annualisedVol(returns, periodsPerYear);
  if (vol === 0) return null;
  return annualisedReturn(returns, periodsPerYear) / vol;
}

export function maxDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst * 100;
}

export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const meanA = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const meanB = b.slice(0, n).reduce((x, y) => x + y, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * How many independent bets a correlated basket actually contains.
 *
 *   N_eff = N / (1 + (N - 1) * mean pairwise correlation)
 *
 * Seven USD-driven FX pairs are not seven bets, and reporting instrument count
 * as though they were is the most common way a diversification claim is
 * overstated. Uses the mean of ABSOLUTE correlations: a pair at -0.9 is just as
 * redundant as one at +0.9, since either can be traded as the other inverted.
 */
export function effectiveBreadth(seriesReturns: number[][]): { breadth: number; meanAbsCorrelation: number } {
  const n = seriesReturns.length;
  if (n <= 1) return { breadth: n, meanAbsCorrelation: 0 };

  const pairs: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = correlation(seriesReturns[i], seriesReturns[j]);
      if (c !== null) pairs.push(Math.abs(c));
    }
  }
  if (pairs.length === 0) return { breadth: n, meanAbsCorrelation: 0 };

  const meanAbs = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  const denominator = 1 + (n - 1) * meanAbs;
  return { breadth: denominator > 0 ? n / denominator : n, meanAbsCorrelation: meanAbs };
}
