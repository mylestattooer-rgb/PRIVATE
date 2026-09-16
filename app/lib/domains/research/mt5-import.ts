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
  /** Usable (strictly positive) samples the quantiles below are computed over. */
  samples: number;
  /**
   * Bars whose `<SPREAD>` cell read exactly 0, excluded from every figure here.
   *
   * Not a tight market — missing data. On the operator's own XAUUSD export
   * 21% of bars read zero, and they arrive in runs (median 7 consecutive
   * minutes, longest 1,236 — over twenty hours) with a *wider* high-low range
   * than the bars around them, which is the opposite of what a genuinely
   * frictionless minute looks like. A bar carrying hundreds of ticks cannot
   * have had no bid-ask spread.
   *
   * Counting them as zeros dragged that export's median from 13 points to 10 —
   * understating the operator's real cost by 30%. Excluding them can in
   * principle overstate cost, if a raw-spread account ever genuinely touches
   * zero. That is the safe direction for a backtest to err in, and this field
   * makes the choice auditable rather than invisible.
   */
  zeroSamples: number;
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
  const zeroSamples = values.filter((v) => v === 0).length;
  const usable = values.filter((v) => v > 0);
  if (usable.length === 0) return null;
  const sorted = usable.sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: sorted.length,
    zeroSamples,
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

    // Number("") is 0, which would record a blank cell as a measured
    // zero-point spread — the most flattering possible fabrication. A cell
    // that literally reads 0 is the same fabrication one level down: see
    // SpreadSummary.zeroSamples for why those are missing data rather than
    // free trading. Both become null on the bar, which means "not measured";
    // the count of the second kind is kept so the gap stays visible.
    const spreadCell = cols.spread === -1 ? "" : (cells[cols.spread] ?? "").trim();
    const spreadRaw = spreadCell === "" ? null : Number(spreadCell);
    const reported = spreadRaw !== null && Number.isFinite(spreadRaw) && spreadRaw >= 0 ? spreadRaw : null;
    if (reported !== null) spreads.push(reported);
    const spreadPoints = reported !== null && reported > 0 ? reported : null;

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
export type AggregateOptions = {
  /**
   * Hours to add back before choosing each bar's calendar day, so bucketing
   * happens on the broker's trading day. Pass whatever was given to
   * `parseMt5Export` as `serverOffsetHours`; leaving it at 0 when the parse
   * shifted the clock is what manufactures the Sunday stubs described below.
   */
  tradingDayOffsetHours?: number;
};

export function spreadPointsToBps(spreadPoints: number, pointSize: number, price: number): number {
  if (price <= 0 || pointSize <= 0) return 0;
  return ((spreadPoints * pointSize) / price) * 10_000;
}

/**
 * Collapse intraday bars into daily ones.
 *
 * MT5's Symbols window exports the timeframe the terminal stores natively,
 * which is M1 — so a "daily history" export arrives as a hundred thousand
 * minute bars. Writing those out with the time stripped produces a file with
 * one row per minute and one date per day, which every downstream calculation
 * then reads as a hundred thousand daily returns of roughly zero. The first
 * real file imported did exactly that.
 *
 * The day's open is its first bar's open, the close its last bar's close, the
 * high and low the extremes across all of them, and volume the sum. Spread is
 * carried as the day's MEDIAN, since a daily bar has no single spread and the
 * mean is dominated by news spikes.
 *
 * **Bucket on the broker's trading day, not the UTC one.** `parseMt5Export`
 * shifts timestamps to UTC, which is right for lining intraday bars up against
 * another venue's clock and wrong here: a daily bar is a trading day. On a
 * GMT+3 server the week opens Monday 01:00 local, which is Sunday 22:00 UTC,
 * so UTC bucketing splits every Monday and emits a Sunday stub. Measured on
 * the operator's own gold export: 92 "days" instead of 77, the 15 extras all
 * Sundays carrying about 7% of a normal day's volume — full trading days as
 * far as anything downstream could tell. Pass the same offset given to
 * `parseMt5Export` and the split does not happen.
 */
export function aggregateToDaily(bars: Mt5Bar[], options: AggregateOptions = {}): Mt5Bar[] {
  if (bars.length === 0) return [];
  const offsetMs = (options.tradingDayOffsetHours ?? 0) * 3_600_000;

  const byDay = new Map<string, Mt5Bar[]>();
  for (const bar of bars) {
    const day =
      offsetMs === 0
        ? bar.time.slice(0, 10)
        : new Date(Date.parse(bar.time) + offsetMs).toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(bar);
    else byDay.set(day, [bar]);
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, dayBars]) => {
      const ordered = [...dayBars].sort((a, b) => a.time.localeCompare(b.time));
      const spreads = ordered
        .map((b) => b.spreadPoints)
        .filter((s): s is number => s !== null)
        .sort((a, b) => a - b);

      return {
        time: `${day}T00:00:00.000Z`,
        open: ordered[0].open,
        high: Math.max(...ordered.map((b) => b.high)),
        low: Math.min(...ordered.map((b) => b.low)),
        close: ordered[ordered.length - 1].close,
        volume: ordered.reduce((sum, b) => sum + b.volume, 0),
        spreadPoints: spreads.length > 0 ? spreads[Math.floor(spreads.length / 2)] : null,
      };
    });
}

/** True when the series is finer than daily — i.e. more than one bar per day. */
export function isIntraday(bars: Mt5Bar[]): boolean {
  if (bars.length < 2) return false;
  const days = new Set(bars.map((b) => b.time.slice(0, 10)));
  return bars.length > days.size;
}
