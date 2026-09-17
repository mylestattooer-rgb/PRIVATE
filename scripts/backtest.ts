#!/usr/bin/env tsx
/**
 * Backtest runner CLI.
 *
 *   npm run backtest                          synthetic data, reproducible from --seed
 *   npm run backtest -- --csv data/spy.csv    real OHLCV data
 *   npm run backtest -- --help                every option
 *
 * Synthetic data exists so the harness is runnable with nothing installed and
 * no vendor account, and so a change to the engine can be diffed against a
 * known series. It is a seeded random walk with trend regimes — it is NOT a
 * market, and a good result on it means nothing whatsoever about a strategy.
 */

import { readFileSync } from "node:fs";
import {
  createPaperBroker,
  createSmaCrossoverStrategy,
  DEFAULT_RISK_LIMITS,
  parseCsvBars,
  runBacktest,
  type Bar,
  type BacktestResult,
} from "../app/lib/domains/simulator";

type Options = {
  symbol: string;
  csv: string | null;
  bars: number;
  seed: number;
  cash: number;
  fast: number;
  slow: number;
  riskPct: number;
  dailyLossPct: number;
  slippageBps: number;
  showTrades: number;
};

const DEFAULTS: Options = {
  symbol: "SYNTH",
  csv: null,
  bars: 500,
  seed: 42,
  cash: 10_000,
  fast: 10,
  slow: 30,
  riskPct: DEFAULT_RISK_LIMITS.maxRiskPerTradePct,
  dailyLossPct: DEFAULT_RISK_LIMITS.maxDailyLossPct,
  slippageBps: 5,
  showTrades: 10,
};

function parseArgs(argv: string[]): Options {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split("=");
    const value = inlineValue ?? argv[i + 1];
    const consume = () => {
      if (inlineValue === undefined) i++;
      return value;
    };

    switch (flag) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--symbol": opts.symbol = consume(); break;
      case "--csv": opts.csv = consume(); break;
      case "--bars": opts.bars = Number(consume()); break;
      case "--seed": opts.seed = Number(consume()); break;
      case "--cash": opts.cash = Number(consume()); break;
      case "--fast": opts.fast = Number(consume()); break;
      case "--slow": opts.slow = Number(consume()); break;
      case "--risk": opts.riskPct = Number(consume()); break;
      case "--daily-loss": opts.dailyLossPct = Number(consume()); break;
      case "--slippage": opts.slippageBps = Number(consume()); break;
      case "--show-trades": opts.showTrades = Number(consume()); break;
      default:
        if (flag.startsWith("-")) {
          console.error(`Unknown option: ${flag}\n`);
          printHelp();
          process.exit(1);
        }
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
Backtest runner — paper execution only, never a live venue.

Usage: npm run backtest -- [options]

  --symbol <s>        Symbol label, and the CSV's instrument      (default SYNTH)
  --csv <path>        OHLCV CSV to load instead of synthetic data
  --bars <n>          Synthetic bars to generate                  (default 500)
  --seed <n>          Synthetic series seed; same seed, same data (default 42)
  --cash <n>          Starting cash                               (default 10000)
  --fast <n>          Fast moving-average period                  (default 10)
  --slow <n>          Slow moving-average period                  (default 30)
  --risk <pct>        Percent of equity risked per trade          (default 1)
  --daily-loss <pct>  Daily loss that halts trading               (default 3)
  --slippage <bps>    Slippage applied against every fill         (default 5)
  --show-trades <n>   Trades to print                             (default 10)
`);
}

/** mulberry32 — small, fast, and seeded, so every run is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded random walk with occasional trend regimes. Deterministic fixture
 *  data, not a simulation of any market's actual behaviour. */
function generateBars(count: number, seed: number): Bar[] {
  const rng = makeRng(seed);
  const bars: Bar[] = [];
  let price = 100;
  let drift = 0;
  let regimeLeft = 0;
  const start = Date.UTC(2024, 0, 1);

  for (let i = 0; i < count; i++) {
    if (regimeLeft <= 0) {
      regimeLeft = 20 + Math.floor(rng() * 60);
      drift = (rng() - 0.45) * 0.004;
    }
    regimeLeft--;

    const open = price;
    const shock = (rng() - 0.5) * 0.02;
    const close = Math.max(1, open * (1 + drift + shock));
    const high = Math.max(open, close) * (1 + rng() * 0.008);
    const low = Math.min(open, close) * (1 - rng() * 0.008);

    bars.push({
      time: new Date(start + i * 86_400_000).toISOString(),
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: Math.floor(500_000 + rng() * 1_000_000),
    });
    price = close;
  }
  return bars;
}

const money = (n: number): string =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null): string => (n === null ? "  n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const num = (n: number | null, digits = 2): string => (n === null ? "n/a" : n.toFixed(digits));

/** Braille-free ASCII equity curve — readable in any terminal and in CI logs. */
function sparkChart(values: number[], width = 72, height = 12): string {
  if (values.length < 2) return "(not enough data to plot)";

  const step = values.length / width;
  const sampled = Array.from({ length: width }, (_, i) => values[Math.min(values.length - 1, Math.floor(i * step))]);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const span = max - min || 1;

  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    const lo = min + (span * row) / height;
    const hi = min + (span * (row + 1)) / height;
    const label = row === height - 1 ? max : row === 0 ? min : null;
    const gutter = (label === null ? "" : money(label)).padStart(12);
    rows.push(
      `${gutter} │` + sampled.map((v) => (v >= lo && v <= hi ? "█" : " ")).join(""),
    );
  }
  rows.push(`${" ".repeat(12)} └${"─".repeat(width)}`);
  return rows.join("\n");
}

function report(result: BacktestResult, opts: Options): void {
  const m = result.metrics;
  const line = (label: string, value: string) => `  ${label.padEnd(26)}${value.padStart(16)}`;

  const WIDTH = 78;
  const boxed = (text: string) => `│ ${text.slice(0, WIDTH - 2).padEnd(WIDTH - 2)} │`;
  console.log(`\n╭${"─".repeat(WIDTH)}╮`);
  console.log(boxed(`BACKTEST — ${result.strategy} on ${result.symbol}`));
  console.log(boxed(`data: ${result.dataSourceId}   execution: ${result.adapter} (simulated)`));
  console.log(`╰${"─".repeat(WIDTH)}╯`);

  console.log(sparkChart(result.equityCurve.map((p) => p.equity)));

  console.log(`\n  RESULT`);
  console.log(line("Starting equity", money(m.startingEquity)));
  console.log(line("Ending equity", money(m.endingEquity)));
  console.log(line("Total return", pct(m.totalReturnPct)));
  console.log(line("Max drawdown", `${pct(-m.maxDrawdownPct)} (${money(m.maxDrawdownAmount)})`));
  console.log(line("Sharpe (annualized)", num(m.sharpe)));
  console.log(line("Commission paid", money(m.commissionPaid)));

  console.log(`\n  TRADES`);
  console.log(line("Closed trades", String(m.tradeCount)));
  console.log(line("Win rate", m.journal.winRatePct === null ? "n/a" : `${m.journal.winRatePct.toFixed(1)}%`));
  console.log(line("Average R", num(m.journal.avgRMultiple)));
  console.log(line("Profit factor", num(m.profitFactor)));
  console.log(line("Bars tested", String(m.barCount)));

  if (result.killSwitchTrips.length > 0) {
    console.log(`\n  DAILY-LOSS HALTS (${result.killSwitchTrips.length})`);
    for (const trip of result.killSwitchTrips.slice(0, 5)) {
      console.log(`    ${trip.day}  ${trip.reason}`);
    }
  }

  const byReason = new Map<string, number>();
  for (const r of result.rejections) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  if (byReason.size > 0) {
    console.log(`\n  RISK MANAGER REJECTIONS (${result.rejections.length})`);
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(5)}  ${reason}`);
    }
  }

  if (opts.showTrades > 0 && result.trades.length > 0) {
    console.log(`\n  FIRST ${Math.min(opts.showTrades, result.trades.length)} TRADES`);
    console.log(`    ${"entry".padEnd(12)}${"exit".padEnd(12)}${"side".padEnd(7)}${"qty".padStart(6)}${"in".padStart(10)}${"out".padStart(10)}${"net".padStart(12)}${"R".padStart(8)}  reason`);
    for (const t of result.trades.slice(0, opts.showTrades)) {
      console.log(
        `    ${t.entryTime.slice(0, 10).padEnd(12)}${t.exitTime.slice(0, 10).padEnd(12)}${t.side.padEnd(7)}` +
          `${String(t.quantity).padStart(6)}${t.entryPrice.toFixed(2).padStart(10)}${t.exitPrice.toFixed(2).padStart(10)}` +
          `${money(t.netPnl).padStart(12)}${num(t.rMultiple).padStart(8)}  ${t.exitReason}`,
      );
    }
  }

  console.log(`\n  Simulated fills against historical bars. No order reached a venue.\n`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const bars = opts.csv ? parseCsvBars(readFileSync(opts.csv, "utf8")) : generateBars(opts.bars, opts.seed);
  const dataSourceId = opts.csv ? `csv:${opts.csv}` : `synthetic:seed-${opts.seed}`;

  if (bars.length === 0) {
    console.error("No bars to test.");
    process.exit(1);
  }

  const result = await runBacktest({
    symbol: opts.symbol,
    bars,
    strategy: createSmaCrossoverStrategy({ fastPeriod: opts.fast, slowPeriod: opts.slow }),
    adapter: createPaperBroker({
      slippageBps: opts.slippageBps,
      commission: { perUnit: 0, percentOfNotional: 0.02, minimum: 1 },
    }),
    startingCash: opts.cash,
    limits: {
      ...DEFAULT_RISK_LIMITS,
      maxRiskPerTradePct: opts.riskPct,
      maxDailyLossPct: opts.dailyLossPct,
    },
    dataSourceId,
  });

  report(result, opts);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
