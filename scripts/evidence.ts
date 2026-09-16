#!/usr/bin/env tsx
/**
 * Evidence runner. Implements EVIDENCE_PROTOCOL.md.
 *
 *   npm run evidence -- --sweep --symbol EURUSD      in-sample grid search
 *   npm run evidence -- --symbol EURUSD --fast 10 --slow 50          one config, in-sample
 *   npm run evidence -- --symbol EURUSD --fast 10 --slow 50 --OUT-OF-SAMPLE
 *
 * The out-of-sample flag is deliberately ugly and deliberately not a default.
 * Protocol §8 allows exactly one out-of-sample run per frozen configuration, and
 * the easiest way to violate that is to make it convenient.
 */

import { readFileSync } from "node:fs";
import {
  buyAndHold,
  createPaperBroker,
  createSmaCrossoverStrategy,
  DEFAULT_RISK_LIMITS,
  evaluate,
  parseCsvBars,
  runBacktest,
  splitBars,
  type BacktestResult,
  type CostModel,
} from "../app/lib/domains/simulator";

const SPLIT_DATE = "2020-01-01T00:00:00.000Z";
const STARTING_CASH = 10_000;

/**
 * Protocol §4 costs. Spread for GCUSD is now MEASURED, the rest are still
 * assumed — the distinction is marked per row rather than left to memory.
 *
 * GCUSD's figure comes from 99,879 minute bars exported from the operator's own
 * MT5 terminal (XAUUSD, 2026-06-02 to 2026-09-16): median spread 10 points at a
 * 0.01 point size on a ~4342 price = 0.230 bps round trip, so 0.115 bps a side.
 * The previous assumption of 1.25 bps a side was about eleven times too
 * pessimistic.
 *
 * COMEX GCUSD stands in for the broker's XAUUSD on the strength of a measured
 * 0.99 return correlation at 20-40 day horizons (0.84 at one day, which is
 * venue and snapshot-time noise) and roughly 0.9%/yr of drift.
 *
 * Financing stays ASSUMED for every row: it comes from the symbol
 * specification's swap rates, which have not been supplied.
 */
const INSTRUMENTS: Record<string, { halfSpreadBps: number; commissionBps: number; annualFinancingPct: number; barsPerYear: number; spreadMeasured: boolean }> = {
  EURUSD: { halfSpreadBps: 0.75, commissionBps: 0.5, annualFinancingPct: 3, barsPerYear: 252, spreadMeasured: false },
  GCUSD: { halfSpreadBps: 0.115, commissionBps: 0.5, annualFinancingPct: 3, barsPerYear: 252, spreadMeasured: true },
  BTCUSD: { halfSpreadBps: 5, commissionBps: 1, annualFinancingPct: 10, barsPerYear: 365, spreadMeasured: false },
};

function costModel(symbol: string): CostModel {
  const spec = INSTRUMENTS[symbol];
  if (!spec) throw new Error(`no cost model for ${symbol}`);
  return {
    halfSpreadBps: spec.halfSpreadBps,
    commissionBps: spec.commissionBps,
    // Annual rate spread across the bars that actually occur in a year, so the
    // total annual cost is right regardless of how many bars the venue trades.
    financingBpsPerBar: (spec.annualFinancingPct / spec.barsPerYear) * 100,
  };
}

type Config = { fast: number; slow: number; atrStop: number; rewardToRisk: number };

async function run(symbol: string, bars: ReturnType<typeof parseCsvBars>, config: Config): Promise<BacktestResult> {
  const costs = costModel(symbol);
  return runBacktest({
    symbol,
    bars,
    strategy: createSmaCrossoverStrategy({
      fastPeriod: config.fast,
      slowPeriod: config.slow,
      atrStopMultiple: config.atrStop,
      rewardToRisk: config.rewardToRisk,
    }),
    adapter: createPaperBroker({
      slippageBps: costs.halfSpreadBps,
      commission: { perUnit: 0, percentOfNotional: costs.commissionBps / 100, minimum: 0 },
    }),
    startingCash: STARTING_CASH,
    limits: DEFAULT_RISK_LIMITS,
    financingBpsPerBar: costs.financingBpsPerBar,
    dataSourceId: `fmp:${symbol}:1d`,
    periodsPerYear: INSTRUMENTS[symbol].barsPerYear,
  });
}

function loadBars(symbol: string) {
  return parseCsvBars(readFileSync(`data/${symbol}_1d.csv`, "utf8"));
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

async function sweep(symbol: string): Promise<void> {
  const { inSample } = splitBars(loadBars(symbol), SPLIT_DATE);
  const grid: Config[] = [];
  for (const fast of [5, 10, 20]) {
    for (const slow of [50, 100, 200]) {
      for (const atrStop of [2, 3]) {
        for (const rewardToRisk of [0, 2]) grid.push({ fast, slow, atrStop, rewardToRisk });
      }
    }
  }

  console.log(`\n=== IN-SAMPLE SWEEP: ${symbol} ===`);
  console.log(`${inSample.length} bars, ${inSample[0].time.slice(0, 10)} -> ${inSample[inSample.length - 1].time.slice(0, 10)}`);
  console.log(`${grid.length} configurations evaluated (disclosed per protocol §8.1)\n`);

  const baseline = buyAndHold(inSample, STARTING_CASH, costModel(symbol));
  const spec = INSTRUMENTS[symbol];
  console.log(`  spread: ${spec.halfSpreadBps} bps/side (${spec.spreadMeasured ? "MEASURED from the broker's export" : "assumed"}), financing ${spec.annualFinancingPct}%/yr (assumed)`);
  console.log(`  buy-and-hold baseline: ${pct(baseline.totalReturnPct)}  (drawdown ${baseline.maxDrawdownPct.toFixed(1)}%)\n`);

  const rows: { config: Config; result: BacktestResult }[] = [];
  for (const config of grid) rows.push({ config, result: await run(symbol, inSample, config) });

  rows.sort((a, b) => b.result.metrics.totalReturnPct - a.result.metrics.totalReturnPct);
  console.log(`  ${"fast/slow".padEnd(11)}${"atr".padStart(4)}${"rr".padStart(4)}${"return".padStart(10)}${"DD".padStart(9)}${"trades".padStart(8)}${"PF".padStart(8)}${"costs".padStart(10)}`);
  for (const { config, result: r } of rows.slice(0, 10)) {
    const m = r.metrics;
    console.log(
      `  ${`${config.fast}/${config.slow}`.padEnd(11)}${String(config.atrStop).padStart(4)}${String(config.rewardToRisk).padStart(4)}` +
        `${pct(m.totalReturnPct).padStart(10)}${`${m.maxDrawdownPct.toFixed(1)}%`.padStart(9)}${String(m.tradeCount).padStart(8)}` +
        `${(m.profitFactor ?? 0).toFixed(2).padStart(8)}${`$${m.totalCosts.toFixed(0)}`.padStart(10)}`,
    );
  }

  const beat = rows.filter((r) => r.result.metrics.totalReturnPct > baseline.totalReturnPct).length;
  console.log(`\n  ${beat}/${grid.length} configurations beat buy-and-hold in-sample.`);
}

async function single(symbol: string, config: Config, outOfSample: boolean): Promise<void> {
  const split = splitBars(loadBars(symbol), SPLIT_DATE);
  const bars = outOfSample ? split.outOfSample : split.inSample;
  const window = outOfSample ? "OUT-OF-SAMPLE" : "in-sample";

  console.log(`\n=== ${window}: ${symbol} sma-${config.fast}/${config.slow} atr${config.atrStop} rr${config.rewardToRisk} ===`);
  console.log(`${bars.length} bars, ${bars[0].time.slice(0, 10)} -> ${bars[bars.length - 1].time.slice(0, 10)}`);

  const result = await run(symbol, bars, config);
  const baseline = buyAndHold(bars, STARTING_CASH, costModel(symbol));
  const m = result.metrics;

  console.log(`\n  STRATEGY`);
  console.log(`    net return        ${pct(m.totalReturnPct)}`);
  console.log(`    max drawdown      ${m.maxDrawdownPct.toFixed(2)}%`);
  console.log(`    trades            ${m.tradeCount}`);
  console.log(`    win rate          ${m.journal.winRatePct === null ? "n/a" : `${m.journal.winRatePct.toFixed(1)}%`}`);
  console.log(`    profit factor     ${m.profitFactor === null ? "n/a" : m.profitFactor.toFixed(3)}`);
  console.log(`    costs             $${m.totalCosts.toFixed(2)} (commission $${m.commissionPaid.toFixed(2)}, financing $${m.financingPaid.toFixed(2)})`);

  console.log(`\n  BASELINE (buy and hold, same costs)`);
  console.log(`    net return        ${pct(baseline.totalReturnPct)}`);
  console.log(`    max drawdown      ${baseline.maxDrawdownPct.toFixed(2)}%`);

  if (outOfSample) {
    const evaluation = evaluate(result, baseline);
    console.log(`\n  PRE-REGISTERED CRITERIA`);
    for (const c of evaluation.criteria) {
      console.log(`    ${c.passed ? "PASS" : "FAIL"}  ${String(c.id)}. ${c.name.padEnd(34)} ${c.observed.padStart(22)}   (${c.threshold})`);
    }
    console.log(`\n  VERDICT: ${evaluation.passed ? "PASS" : "FAIL"}\n`);
  } else {
    console.log("");
  }
}

/**
 * How much does the unknown swap rate actually matter?
 *
 * Financing is the one cost still assumed rather than measured. Rather than
 * treat that as blocking, this sweeps it across every plausible rate and asks
 * where — if anywhere — the verdict would change.
 *
 * The asymmetry is the point: buy-and-hold pays financing every single day it
 * is held, while the strategy pays only while it happens to be in a position.
 * A higher swap rate therefore hurts the baseline harder than the strategy, so
 * if the strategy ever wins, it wins at HIGH financing, not low.
 */
async function swapSweep(symbol: string): Promise<void> {
  const { inSample } = splitBars(loadBars(symbol), SPLIT_DATE);
  const spec = INSTRUMENTS[symbol];
  const best: Config = { fast: 20, slow: 50, atrStop: 3, rewardToRisk: 0 };

  console.log(`\n=== SWAP SENSITIVITY: ${symbol} ===`);
  console.log(`${inSample.length} bars, ${inSample[0].time.slice(0, 10)} -> ${inSample[inSample.length - 1].time.slice(0, 10)}`);
  console.log(`config fixed at the in-sample best (${best.fast}/${best.slow}, atr ${best.atrStop}, rr ${best.rewardToRisk})`);
  console.log(`spread held at the MEASURED ${spec.halfSpreadBps} bps/side\n`);
  console.log(`  ${"swap %/yr".padEnd(12)}${"strategy".padStart(11)}${"buy & hold".padStart(13)}${"gap".padStart(11)}  verdict`);

  const original = spec.annualFinancingPct;
  for (const rate of [0, 1, 2, 3, 5, 8, 12, 20, 30]) {
    spec.annualFinancingPct = rate;
    const result = await run(symbol, inSample, best);
    const baseline = buyAndHold(inSample, STARTING_CASH, costModel(symbol));
    const gap = result.metrics.totalReturnPct - baseline.totalReturnPct;
    const wins = gap > 0;
    console.log(
      `  ${`${rate}%`.padEnd(12)}${pct(result.metrics.totalReturnPct).padStart(11)}` +
        `${pct(baseline.totalReturnPct).padStart(13)}${pct(gap).padStart(11)}  ${wins ? "STRATEGY WINS" : "baseline wins"}`,
    );
  }
  spec.annualFinancingPct = original;

  console.log(`\n  Both legs pay the same rate. The strategy is only exposed part of the`);
  console.log(`  time, so a higher rate penalises buy-and-hold more — if the ordering`);
  console.log(`  ever flips, it flips at the high end, and the flip point tells you`);
  console.log(`  whether the unmeasured swap rate could plausibly change the verdict.\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string, fallback: number) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(argv[i + 1]);
  };
  const symbolIndex = argv.indexOf("--symbol");
  const symbol = symbolIndex === -1 ? "EURUSD" : argv[symbolIndex + 1];

  if (flag("swap-sweep")) return swapSweep(symbol);
  if (flag("sweep")) return sweep(symbol);

  return single(
    symbol,
    {
      fast: value("fast", 10),
      slow: value("slow", 50),
      atrStop: value("atr", 2),
      rewardToRisk: value("rr", 0),
    },
    flag("OUT-OF-SAMPLE"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
