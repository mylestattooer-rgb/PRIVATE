// Multi-instrument series alignment.
//
// Instruments trade on different calendars: FX and futures on weekdays, crypto
// every day. A portfolio backtest needs one shared timeline, and how you build
// it decides whether the result is real.
//
// Rules here:
//   * The timeline is the UNION of all observed dates, so no instrument's
//     activity is silently discarded.
//   * A price is carried forward when an instrument did not trade, which makes
//     that day's return exactly zero rather than inventing movement.
//   * Before an instrument's first observation its price is null, not
//     back-filled. Back-filling would let a strategy hold something that did not
//     yet exist — a subtle and very flattering form of look-ahead.

export type AlignedSeries = {
  dates: string[];
  /** Per symbol: price on each date, or null before that symbol's first bar. */
  prices: Record<string, (number | null)[]>;
  symbols: string[];
};

export function alignSeries(closesBySymbol: Record<string, { date: string; close: number }[]>): AlignedSeries {
  const symbols = Object.keys(closesBySymbol).sort();

  const allDates = new Set<string>();
  for (const rows of Object.values(closesBySymbol)) {
    for (const row of rows) allDates.add(row.date);
  }
  const dates = [...allDates].sort();

  const prices: Record<string, (number | null)[]> = {};
  for (const symbol of symbols) {
    const bySymbolDate = new Map(closesBySymbol[symbol].map((r) => [r.date, r.close]));
    const column: (number | null)[] = [];
    let last: number | null = null;
    let started = false;

    for (const date of dates) {
      const observed = bySymbolDate.get(date);
      if (observed !== undefined) {
        last = observed;
        started = true;
      }
      // null until the first real observation; carried forward after it.
      column.push(started ? last : null);
    }
    prices[symbol] = column;
  }

  return { dates, prices, symbols };
}

/** Simple period returns. null wherever a return cannot be formed from two
 *  consecutive known prices — never silently zero, which would be a real
 *  observation of "no change". */
export function simpleReturns(prices: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [null];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const now = prices[i];
    out.push(prev !== null && now !== null && prev > 0 ? now / prev - 1 : null);
  }
  return out;
}

/**
 * Annualised realised volatility over the trailing `window` returns ending at
 * `endIndex` inclusive. Returns null when the window is not fully populated —
 * a vol estimate from four observations is not a vol estimate, and using one
 * would size a position on noise.
 */
export function realisedVol(
  returns: (number | null)[],
  window: number,
  endIndex: number,
  periodsPerYear: number,
): number | null {
  if (window < 2 || endIndex < window - 1 || endIndex >= returns.length) return null;

  const slice: number[] = [];
  for (let i = endIndex - window + 1; i <= endIndex; i++) {
    const r = returns[i];
    if (r === null) return null;
    slice.push(r);
  }

  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/** Total return over the trailing `lookback` periods ending at `endIndex`. */
export function trailingReturn(
  prices: (number | null)[],
  lookback: number,
  endIndex: number,
): number | null {
  const start = endIndex - lookback;
  if (start < 0 || endIndex >= prices.length) return null;
  const from = prices[start];
  const to = prices[endIndex];
  if (from === null || to === null || from <= 0) return null;
  return to / from - 1;
}

/**
 * Bars per year in an aligned calendar, measured rather than assumed.
 *
 * This matters more than it looks. A union calendar mixing 7-day crypto with
 * 5-day FX runs at roughly 336 bars a year, not the 252 that "trading days"
 * suggests. Assuming 252 on such a calendar makes a "12-month" lookback really
 * 9 months, understates annualised volatility by a factor of 0.87 (so a 10%
 * volatility target runs about 15% hot), and mis-annualises every reported
 * return and Sharpe ratio. All three happened in the first run of study 2.
 */
export function barsPerYear(dates: string[]): number {
  if (dates.length < 2) return 252;
  const spanMs = Date.parse(dates[dates.length - 1]) - Date.parse(dates[0]);
  const years = spanMs / (365.25 * 24 * 3_600_000);
  if (years <= 0) return 252;
  // N dates span N-1 intervals. Dividing by N overstates the density by
  // N/(N-1), which is small but is a bias rather than noise.
  return (dates.length - 1) / years;
}
