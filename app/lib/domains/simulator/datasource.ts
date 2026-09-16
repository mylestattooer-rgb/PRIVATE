// Market data behind a provider-agnostic interface.
//
// DATABASE.md §2.6 requires a SimulatorSession to reference an abstract
// `dataSourceId` and date range rather than embedding one vendor's schema, so
// swapping in real historical data later is not an education-platform rewrite.
// This is that seam. Nothing downstream of `Bar[]` knows or cares where the
// bars came from.

import type { Bar } from "./types";

export type BarRange = { from: string; to: string };

export type MarketDataSource = {
  /** Stable identifier persisted on a simulator session, so a result can be
   *  traced back to the data that produced it. */
  readonly id: string;
  bars(symbol: string, range?: BarRange): Promise<Bar[]>;
};

export function isValidBar(bar: Bar): boolean {
  const prices = [bar.open, bar.high, bar.low, bar.close];
  if (!prices.every((p) => Number.isFinite(p) && p > 0)) return false;
  if (!Number.isFinite(bar.volume) || bar.volume < 0) return false;
  if (bar.high < Math.max(bar.open, bar.close)) return false;
  if (bar.low > Math.min(bar.open, bar.close)) return false;
  if (bar.high < bar.low) return false;
  return Number.isFinite(Date.parse(bar.time));
}

/**
 * Reject malformed bars before they reach the engine.
 *
 * Real vendor data contains zero-volume placeholder bars, high < low
 * transpositions and duplicated timestamps. Every one of those silently
 * corrupts a backtest — a bar whose high is below its close will trigger
 * stop and target logic that could not have happened. Failing here, loudly,
 * beats a plausible-looking equity curve built on bad input.
 */
export function assertValidSeries(bars: Bar[], sourceId: string): void {
  for (const [i, bar] of bars.entries()) {
    if (!isValidBar(bar)) {
      throw new Error(`${sourceId}: bar ${i} (${bar.time}) is malformed`);
    }
    if (i > 0 && Date.parse(bar.time) <= Date.parse(bars[i - 1].time)) {
      throw new Error(
        `${sourceId}: bar ${i} (${bar.time}) is not strictly after the previous bar ` +
          `(${bars[i - 1].time}) — out-of-order or duplicate data`,
      );
    }
  }
}

/** Bars held in memory, validated on construction. Backs fixtures, tests and
 *  the CSV loader below. */
export function createInMemoryDataSource(
  id: string,
  seriesBySymbol: Record<string, Bar[]>,
): MarketDataSource {
  for (const [symbol, bars] of Object.entries(seriesBySymbol)) {
    assertValidSeries(bars, `${id}:${symbol}`);
  }

  return {
    id,
    async bars(symbol, range) {
      const series = seriesBySymbol[symbol.toUpperCase()] ?? seriesBySymbol[symbol] ?? [];
      if (!range) return [...series];
      const from = Date.parse(range.from);
      const to = Date.parse(range.to);
      return series.filter((b) => {
        const t = Date.parse(b.time);
        return t >= from && t <= to;
      });
    },
  };
}

/**
 * Parse OHLCV CSV with a header row. Column names are matched case-insensitively
 * and accept the common aliases vendors use (`date`/`timestamp`/`time`).
 * Unknown columns are ignored rather than rejected.
 */
export function parseCsvBars(csv: string): Bar[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const indexOfAny = (...names: string[]): number => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i !== -1) return i;
    }
    return -1;
  };

  const cols = {
    time: indexOfAny("time", "timestamp", "date", "datetime"),
    open: indexOfAny("open", "o"),
    high: indexOfAny("high", "h"),
    low: indexOfAny("low", "l"),
    close: indexOfAny("close", "c"),
    volume: indexOfAny("volume", "vol", "v"),
  };

  for (const [name, index] of Object.entries(cols)) {
    if (index === -1 && name !== "volume") {
      throw new Error(`parseCsvBars: required column "${name}" not found in header`);
    }
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return {
      time: new Date(cells[cols.time]).toISOString(),
      open: Number(cells[cols.open]),
      high: Number(cells[cols.high]),
      low: Number(cells[cols.low]),
      close: Number(cells[cols.close]),
      volume: cols.volume === -1 ? 0 : Number(cells[cols.volume]),
    };
  });
}
