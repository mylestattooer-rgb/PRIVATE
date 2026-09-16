// MetaTrader 5 history import.
//
// Worth more than convenience: an MT5 export carries a `<SPREAD>` column, in
// points, per bar. That is **measured** spread from the operator's own broker —
// the single figure both evidence studies so far have had to assume, and the
// one that decides whether any strategy is implementable at that account.
//
// It also means prices are the broker's own, so a backtest is run against the
// quotes that would actually have been available rather than a data vendor's
// composite.
//
// MT5's export format, tab-separated, header in angle brackets:
//
//   <DATE>	<TIME>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
//   2024.01.02	00:00:00	2063.10	2065.50	2061.20	2064.30	1234	0	25
//
// Daily exports sometimes omit <TIME>, and older builds emit comma separators,
// so both are handled. Columns are matched by name, never by position.

export type Mt5Bar = {
  /** ISO-8601, UTC. MT5 timestamps are in the broker's server timezone, which
   *  is usually NOT UTC — see `serverOffsetHours`. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Spread in points at the bar's close, when the export includes it. */
  spreadPoints: number | null;
};

export type Mt5ImportResult = {
  bars: Mt5Bar[];
  /** Rows rejected as malformed, with the reason, so a bad export is visible
   *  rather than silently shortening the series. */
  rejected: { line: number; reason: string }[];
  spread: SpreadSummary | null;
  columns: string[];
};

export type SpreadSummary = {
  samples: number;
  medianPoints: number;
  meanPoints: number;
  p95Points: number;
  maxPoints: number;
};

export type Mt5ImportOptions = {
  /** Hours to subtract to reach UTC. Most brokers run the terminal on a
   *  GMT+2/+3 server, so daily bars close at 00:00 server time, not midnight
   *  UTC. Getting this wrong shifts every bar by a day against other data. */
  serverOffsetHours?: number;
};

function parseMt5Date(date: string, time: string | null, offsetHours: number): string | null {
  // 2024.01.02 or 2024-01-02
  const match = date.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (time) {
    const t = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!t) return null;
    hours = Number(t[1]);
    minutes = Number(t[2]);
    seconds = Number(t[3] ?? 0);
  }

  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), hours, minutes, seconds);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - offsetHours * 3_600_000).toISOString();
}

function summariseSpread(values: number[]): SpreadSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: sorted.length,
    // Median rather than mean is the headline: spread distributions have a long
    // right tail from news and rollover, and the mean reports a cost the
    // operator rarely actually pays.
    medianPoints: at(0.5),
    meanPoints: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p95Points: at(0.95),
    maxPoints: sorted[sorted.length - 1],
  };
}

export function parseMt5Export(text: string, options: Mt5ImportOptions = {}): Mt5ImportResult {
  const offsetHours = options.serverOffsetHours ?? 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { bars: [], rejected: [], spread: null, columns: [] };

  const separator = lines[0].includes("\t") ? "\t" : ",";
  const columns = lines[0]
    .split(separator)
    .map((h) => h.trim().replace(/^<|>$/g, "").toLowerCase());

  const index = (...names: string[]) => {
    for (const name of names) {
      const i = columns.indexOf(name);
      if (i !== -1) return i;
    }
    return -1;
  };

  const cols = {
    date: index("date"),
    time: index("time"),
    open: index("open"),
    high: index("high"),
    low: index("low"),
    close: index("close"),
    volume: index("tickvol", "volume", "vol"),
    spread: index("spread"),
  };

  if (cols.date === -1 || cols.open === -1 || cols.high === -1 || cols.low === -1 || cols.close === -1) {
    throw new Error(
      `parseMt5Export: missing a required column. Found [${columns.join(", ")}] — ` +
        `expected at least date, open, high, low, close.`,
    );
  }

  const bars: Mt5Bar[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const spreads: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(separator).map((c) => c.trim());
    const time = parseMt5Date(cells[cols.date], cols.time === -1 ? null : cells[cols.time], offsetHours);
    if (time === null) {
      rejected.push({ line: i + 1, reason: `unparseable date/time "${cells[cols.date]}"` });
      continue;
    }

    const open = Number(cells[cols.open]);
    const high = Number(cells[cols.high]);
    const low = Number(cells[cols.low]);
    const close = Number(cells[cols.close]);

    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) {
      rejected.push({ line: i + 1, reason: "non-positive or non-numeric price" });
      continue;
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      rejected.push({ line: i + 1, reason: `inconsistent OHLC (o${open} h${high} l${low} c${close})` });
      continue;
    }

    const spreadRaw = cols.spread === -1 ? null : Number(cells[cols.spread]);
    const spreadPoints = spreadRaw !== null && Number.isFinite(spreadRaw) && spreadRaw >= 0 ? spreadRaw : null;
    if (spreadPoints !== null) spreads.push(spreadPoints);

    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: cols.volume === -1 ? 0 : Number(cells[cols.volume]) || 0,
      spreadPoints,
    });
  }

  bars.sort((a, b) => a.time.localeCompare(b.time));

  return { bars, rejected, spread: summariseSpread(spreads), columns };
}

/**
 * Convert a measured spread in points into the basis-points figure the cost
 * models use.
 *
 * `pointSize` is the instrument's price increment — 0.00001 for a 5-digit FX
 * pair, 0.01 for gold at two decimals. It comes from the same MT5 symbol
 * specification as everything else, and guessing it is the fastest way to be
 * wrong by a factor of ten.
 */
export function spreadPointsToBps(spreadPoints: number, pointSize: number, price: number): number {
  if (price <= 0 || pointSize <= 0) return 0;
  return ((spreadPoints * pointSize) / price) * 10_000;
}
