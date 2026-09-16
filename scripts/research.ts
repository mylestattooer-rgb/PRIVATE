#!/usr/bin/env tsx
/**
 * Hypothesis 2 — time-series momentum. Implements EVIDENCE_PROTOCOL_2.md.
 *
 *   npm run research                     in-sample (default)
 *   npm run research -- --OUT-OF-SAMPLE  the one permitted out-of-sample run
 *   npm run research -- --sweep          post-hoc robustness over lookback
 *
 * The specification is fixed in the protocol and is NOT searched. --sweep exists
 * only to check the headline is not a knife-edge, and runs after it.
 */

import { readdirSync, readFileSync } from "node:fs";
import {
  alignSeries,
  annualisedReturn,
  annualisedVol,
  barsPerYear,
  calibrate,
  CANONICAL_TSMOM_SPEC,
  effectiveBreadth,
  maxDrawdown,
  runPortfolio,
  sharpe,
  type PortfolioCosts,
  type PortfolioResult,
  type TsmomConfig,
} from "../app/lib/domains/research";

const SPLIT = "2020-01-01";
/** Measured from the aligned calendar, never assumed — see series.barsPerYear. */
let PERIODS_PER_YEAR = 252;

/** Protocol 2 §6 — inherited from protocol 1 and still ASSUMED, not measured.
 *  Turnover cost per unit of weight changed, and financing on gross exposure. */
const COSTS: PortfolioCosts = {
  transactionBps: 2,
  financingBpsPerBar: (3 / PERIODS_PER_YEAR) * 100,
};

function loadUniverse(): Record<string, { date: string; close: number }[]> {
  const universe: Record<string, { date: string; close: number }[]> = {};
  for (const file of readdirSync("data").filter((f) => f.endsWith("_1d.csv")).sort()) {
    const symbol = file.replace("_1d.csv", "");
    const lines = readFileSync(`data/${file}`, "utf8").trim().split("\n").slice(1);
    universe[symbol] = lines.map((line) => {
      const [date, , , , close] = line.split(",");
      return { date, close: Number(close) };
    });
  }
  return universe;
}

type Summary = {
  annualReturn: number;
  annualVol: number;
  sharpeRatio: number | null;
  maxDD: number;
  bars: number;
};

function summarise(result: PortfolioResult): Summary {
  return {
    annualReturn: annualisedReturn(result.returns, PERIODS_PER_YEAR) * 100,
    annualVol: annualisedVol(result.returns, PERIODS_PER_YEAR) * 100,
    sharpeRatio: sharpe(result.returns, PERIODS_PER_YEAR),
    maxDD: maxDrawdown(result.returns),
    bars: result.returns.length,
  };
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const sh = (n: number | null) => (n === null ? "n/a" : n.toFixed(3));

function printSummary(label: string, s: Summary): void {
  console.log(
    `  ${label.padEnd(26)} return ${pct(s.annualReturn).padStart(8)}/yr   vol ${s.annualVol.toFixed(1).padStart(5)}%   ` +
      `Sharpe ${sh(s.sharpeRatio).padStart(7)}   maxDD ${s.maxDD.toFixed(1).padStart(5)}%`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outOfSample = argv.includes("--OUT-OF-SAMPLE");
  const sweep = argv.includes("--sweep");

  const universe = loadUniverse();
  const aligned = alignSeries(universe);
  const symbols = aligned.symbols;

  // The union calendar mixes 7-day crypto with 5-day FX, so it does not run at
  // 252 bars a year. Measuring it is what makes "12 months" mean 12 months.
  PERIODS_PER_YEAR = barsPerYear(aligned.dates);
  const CANONICAL_TSMOM = calibrate(CANONICAL_TSMOM_SPEC, PERIODS_PER_YEAR);

  const bounds = outOfSample ? { from: SPLIT } : { to: "2019-12-31" };
  const window = outOfSample ? "OUT-OF-SAMPLE" : "IN-SAMPLE";

  console.log(`\n${"═".repeat(78)}`);
  console.log(`  HYPOTHESIS 2: time-series momentum — ${window}`);
  console.log(`  ${symbols.length} instruments: ${symbols.join(" ")}`);
  console.log(`  calendar: ${PERIODS_PER_YEAR.toFixed(1)} bars/year (measured, not assumed)`);
  console.log(`  spec: ${CANONICAL_TSMOM_SPEC.lookbackMonths}mo lookback = ${CANONICAL_TSMOM.lookback} bars, ` +
    `${CANONICAL_TSMOM_SPEC.volWindowMonths}mo vol = ${CANONICAL_TSMOM.volWindow} bars, ` +
    `${(CANONICAL_TSMOM.volTargetAnnual * 100).toFixed(0)}% target, rebalance every ${CANONICAL_TSMOM.rebalanceEvery}`);
  console.log(`${"═".repeat(78)}\n`);

  const run = (config: TsmomConfig, mode: "momentum" | "long-only", subset?: string[]) =>
    runPortfolio(aligned, { config, costs: COSTS, signalMode: mode, symbols: subset, ...bounds });

  const strategy = run(CANONICAL_TSMOM, "momentum");
  const longOnly = run(CANONICAL_TSMOM, "long-only");

  console.log(`  ${strategy.dates[0]} -> ${strategy.dates[strategy.dates.length - 1]}  (${strategy.returns.length} bars)\n`);
  printSummary("TSMOM", summarise(strategy));
  printSummary("TSMOM (gross, no costs)", {
    ...summarise(strategy),
    annualReturn: annualisedReturn(strategy.returnsGross, PERIODS_PER_YEAR) * 100,
    annualVol: annualisedVol(strategy.returnsGross, PERIODS_PER_YEAR) * 100,
    sharpeRatio: sharpe(strategy.returnsGross, PERIODS_PER_YEAR),
    maxDD: maxDrawdown(strategy.returnsGross),
  });
  printSummary("Long-only (same sizing)", summarise(longOnly));
  printSummary("Cash", { annualReturn: 0, annualVol: 0, sharpeRatio: null, maxDD: 0, bars: 0 });

  // ---- raw signal diagnostic ----
  // Independent of portfolio construction, costs and sizing: over every
  // rebalance, did the sign of the trailing return match the sign of the NEXT
  // period's return? This separates "the signal has no edge in this universe"
  // from "the construction loses an edge that exists".
  {
    let hits = 0;
    let total = 0;
    const perSymbol: { symbol: string; hitRate: number; n: number }[] = [];
    for (const symbol of symbols) {
      const prices = aligned.prices[symbol];
      let sHits = 0;
      let sTotal = 0;
      const lo = CANONICAL_TSMOM.lookback;
      const step = CANONICAL_TSMOM.rebalanceEvery;
      const lastIndex = aligned.dates.findIndex((d) => d > (bounds.to ?? "9999"));
      const end = (lastIndex === -1 ? aligned.dates.length : lastIndex) - step - 1;
      const begin = bounds.from ? aligned.dates.findIndex((d) => d >= bounds.from!) : 0;
      for (let i = Math.max(lo, begin); i < end; i += step) {
        const past = prices[i - lo];
        const nowP = prices[i];
        const future = prices[i + step];
        if (past === null || nowP === null || future === null || past <= 0 || nowP <= 0) continue;
        const signal = nowP / past - 1 >= 0 ? 1 : -1;
        const forward = future / nowP - 1;
        if (forward === 0) continue;
        sTotal++;
        if (Math.sign(forward) === signal) sHits++;
      }
      if (sTotal > 0) perSymbol.push({ symbol, hitRate: (sHits / sTotal) * 100, n: sTotal });
      hits += sHits;
      total += sTotal;
    }
    console.log(`\n  RAW SIGNAL (does trailing-return sign predict next-period sign?)`);
    console.log(`    pooled hit rate       ${((hits / total) * 100).toFixed(1)}%  over ${total} instrument-periods`);
    console.log(`    (50% is no information; published TSMOM sits a few points above)`);
    const sorted = [...perSymbol].sort((a, b) => b.hitRate - a.hitRate);
    console.log(`    best  ${sorted[0].symbol} ${sorted[0].hitRate.toFixed(1)}%    worst ${sorted[sorted.length - 1].symbol} ${sorted[sorted.length - 1].hitRate.toFixed(1)}%`);
  }

  console.log(`\n  MECHANICS`);
  console.log(`    rebalances            ${strategy.rebalanceCount}`);
  console.log(`    mean turnover         ${strategy.meanTurnover.toFixed(3)} (sum of |weight change|)`);
  console.log(`    mean gross exposure   ${strategy.meanGrossExposure.toFixed(2)}x   max ${strategy.maxGrossExposure.toFixed(2)}x`);
  console.log(`    weight cap bound      ${(strategy.capBindRate * 100).toFixed(1)}% of the time`);
  console.log(`    total cost drag       ${(strategy.totalCostDrag * 100).toFixed(2)}% of starting capital`);

  // ---- per-instrument contributions ----
  const contributions = symbols
    .map((s) => ({ symbol: s, contribution: strategy.contributionBySymbol[s] * 100 }))
    .sort((a, b) => b.contribution - a.contribution);

  console.log(`\n  CONTRIBUTION BY INSTRUMENT (% of starting capital, whole window)`);
  for (const c of contributions) {
    const bar = "█".repeat(Math.min(30, Math.max(0, Math.round(Math.abs(c.contribution) / 2))));
    console.log(`    ${c.symbol.padEnd(9)} ${pct(c.contribution).padStart(9)}  ${bar}`);
  }

  const positive = contributions.filter((c) => c.contribution > 0).length;

  // ---- effective breadth ----
  const { breadth, meanAbsCorrelation } = effectiveBreadth(symbols.map((s) => strategy.contributionSeries[s]));
  console.log(`\n  DIVERSIFICATION`);
  console.log(`    instruments           ${symbols.length}`);
  console.log(`    mean |correlation|    ${meanAbsCorrelation.toFixed(3)}`);
  console.log(`    effective breadth     ${breadth.toFixed(2)} independent bets`);

  // ---- predictions ----
  console.log(`\n  PREDICTIONS (EVIDENCE_PROTOCOL_2.md §3)`);

  const soloSharpes = symbols
    .map((s) => sharpe(run(CANONICAL_TSMOM, "momentum", [s]).returns, PERIODS_PER_YEAR))
    .filter((x): x is number => x !== null);
  const meanSolo = soloSharpes.reduce((a, b) => a + b, 0) / (soloSharpes.length || 1);
  const basketSharpe = sharpe(strategy.returns, PERIODS_PER_YEAR);
  const p1 = basketSharpe !== null && basketSharpe > meanSolo;
  console.log(`    P1 basket beats mean single-instrument Sharpe   ${p1 ? "HOLDS" : "FAILS"}  ` +
    `(${sh(basketSharpe)} vs ${meanSolo.toFixed(3)})`);

  const p2 = positive >= Math.ceil(symbols.length / 2);
  console.log(`    P2 majority of instruments positive            ${p2 ? "HOLDS" : "FAILS"}  (${positive}/${symbols.length})`);

  const longOnlySharpe = sharpe(longOnly.returns, PERIODS_PER_YEAR);
  const p3 = basketSharpe !== null && longOnlySharpe !== null && basketSharpe > longOnlySharpe;
  console.log(`    P3 not explained by long-only beta            ${p3 ? "HOLDS" : "FAILS"}  ` +
    `(${sh(basketSharpe)} vs ${sh(longOnlySharpe)})`);

  // P4: the protocol asks pre-2010 vs post-2010, but the data starts in 2007,
  // so the literal split leaves a ~2y first period. Both are reported.
  const mid = strategy.dates[Math.floor(strategy.dates.length / 2)];
  const firstHalf = strategy.returns.slice(0, Math.floor(strategy.returns.length / 2));
  const secondHalf = strategy.returns.slice(Math.floor(strategy.returns.length / 2));
  const s1 = sharpe(firstHalf, PERIODS_PER_YEAR);
  const s2 = sharpe(secondHalf, PERIODS_PER_YEAR);
  const p4 = s1 !== null && s2 !== null && s2 < s1;
  console.log(`    P4 weaker in the later half                    ${p4 ? "HOLDS" : "FAILS"}  ` +
    `(${sh(s1)} before ${mid}, ${sh(s2)} after)`);
  if (!p4) console.log(`       NOTE: a stronger later period is the suspicious direction, per §3.`);

  const gross = annualisedReturn(strategy.returnsGross, PERIODS_PER_YEAR) * 100;
  const net = annualisedReturn(strategy.returns, PERIODS_PER_YEAR) * 100;
  const p5 = net > 0;
  console.log(`    P5 survives costs                             ${p5 ? "HOLDS" : "FAILS"}  ` +
    `(gross ${pct(gross)}/yr -> net ${pct(net)}/yr)`);

  // ---- leave-one-out ----
  const best = contributions[0];
  const withoutBest = run(CANONICAL_TSMOM, "momentum", symbols.filter((s) => s !== best.symbol));
  const withoutBestSummary = summarise(withoutBest);
  console.log(`\n  CONCENTRATION`);
  console.log(`    largest contributor   ${best.symbol} (${pct(best.contribution)})`);
  printSummary(`    without ${best.symbol}`, withoutBestSummary);

  if (outOfSample) {
    console.log(`\n  PRE-REGISTERED CRITERIA (EVIDENCE_PROTOCOL_2.md §8)`);
    const s = summarise(strategy);
    const checks = [
      { id: 1, name: "Annualised return > 0", ok: s.annualReturn > 0, observed: pct(s.annualReturn) },
      { id: 2, name: "Sharpe >= 0.4", ok: (s.sharpeRatio ?? -1) >= 0.4, observed: sh(s.sharpeRatio) },
      { id: 3, name: "Max drawdown <= 25%", ok: s.maxDD <= 25, observed: `${s.maxDD.toFixed(1)}%` },
      { id: 4, name: "Beats long-only on Sharpe", ok: p3, observed: `${sh(basketSharpe)} vs ${sh(longOnlySharpe)}` },
      { id: 5, name: "Half the universe positive", ok: p2, observed: `${positive}/${symbols.length}` },
      { id: 6, name: "Survives losing best instrument", ok: withoutBestSummary.annualReturn > 0, observed: pct(withoutBestSummary.annualReturn) },
    ];
    for (const c of checks) {
      console.log(`    ${c.ok ? "PASS" : "FAIL"}  ${c.id}. ${c.name.padEnd(34)} ${c.observed.padStart(18)}`);
    }
    console.log(`\n  VERDICT: ${checks.every((c) => c.ok) ? "PASS" : "FAIL"}`);
  }

  if (sweep) {
    console.log(`\n  ROBUSTNESS — lookback sweep (post-hoc; headline stays ${CANONICAL_TSMOM.lookback}d)`);
    for (const months of [3, 6, 9, 12, 15, 18]) {
      const cfg = calibrate({ ...CANONICAL_TSMOM_SPEC, lookbackMonths: months }, PERIODS_PER_YEAR);
      const s = summarise(run(cfg, "momentum"));
      console.log(`    ${String(months).padStart(2)}mo (${String(cfg.lookback).padStart(3)} bars)   return ${pct(s.annualReturn).padStart(8)}/yr   Sharpe ${sh(s.sharpeRatio).padStart(7)}   maxDD ${s.maxDD.toFixed(1).padStart(5)}%`);
    }
  }

  console.log("");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
