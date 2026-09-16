/**
 * Hypothesis 3 — five-minute reversion after absorption in XAUUSD.
 *
 *   npx tsx scripts/study3.ts
 *
 * Every parameter is fixed by EVIDENCE_PROTOCOL_3.md, which was committed
 * before this file existed. Nothing here is a free choice, and nothing may be
 * changed to improve a result. Read the protocol first; this is only its
 * execution.
 */

import { readFileSync } from "node:fs";
import { parseMt5Export, spreadPointsToBps, type Mt5Bar } from "../app/lib/domains/research";

// ---- fixed by protocol §4 -------------------------------------------------
const FILE = "/root/.claude/uploads/f3e00d24-d16c-5917-8a72-4acfbf8cae47/1ed577d2-XAUUSD_M1_202606021259_202609161308.csv";
const SERVER_OFFSET = 3;
const HORIZON = 5; // minutes
const TRAILING_MINUTES = 1000;
const IN_SAMPLE_FRACTION = 0.7;
const POINT_SIZE = 0.01;
const SPREAD_POINTS = 13; // median, excluding the bars reporting zero
const P1_THRESHOLD = 0.5434; // break-even 52.86% + detectable 1.48pt

type Observation = {
  index: number;
  time: number;
  hour: number;
  triggerBps: number; // signed 5-minute return into the decision bar
  forwardBps: number; // signed 5-minute return after it
  trailingMedian: number; // causal median of |trigger| over TRAILING_MINUTES
};

function build(bars: Mt5Bar[]): Observation[] {
  const times = bars.map((b) => Date.parse(b.time));
  const closes = bars.map((b) => b.close);
  const step = HORIZON * 60_000;
  const out: Observation[] = [];

  // Non-overlapping: one observation every HORIZON bars, so no two forward
  // windows share a minute.
  for (let i = HORIZON; i + HORIZON < bars.length; i += HORIZON) {
    if (times[i] - times[i - HORIZON] !== step) continue;
    if (times[i + HORIZON] - times[i] !== step) continue;
    if (closes[i - HORIZON] <= 0 || closes[i] <= 0) continue;

    const triggerBps = (closes[i] / closes[i - HORIZON] - 1) * 10_000;
    const forwardBps = (closes[i + HORIZON] / closes[i] - 1) * 10_000;

    // Causal trailing median: only observations strictly before this one, and
    // only those inside the trailing window.
    const cutoff = times[i] - TRAILING_MINUTES * 60_000;
    const prior: number[] = [];
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j].time < cutoff) break;
      prior.push(Math.abs(out[j].triggerBps));
    }
    if (prior.length < 20) {
      out.push({ index: i, time: times[i], hour: new Date(times[i]).getUTCHours(), triggerBps, forwardBps, trailingMedian: NaN });
      continue;
    }
    prior.sort((a, b) => a - b);

    out.push({
      index: i,
      time: times[i],
      hour: new Date(times[i]).getUTCHours(),
      triggerBps,
      forwardBps,
      trailingMedian: prior[Math.floor(prior.length / 2)],
    });
  }
  return out;
}

/** Reversion is called: short after an up-move, long after a down-move. */
function outcome(o: Observation): "hit" | "miss" | "flat" {
  if (o.forwardBps === 0) return "flat";
  return Math.sign(o.forwardBps) !== Math.sign(o.triggerBps) ? "hit" : "miss";
}

function rate(obs: Observation[]): { hits: number; misses: number; flats: number; rate: number; rateWithFlats: number } {
  let hits = 0;
  let misses = 0;
  let flats = 0;
  for (const o of obs) {
    const r = outcome(o);
    if (r === "hit") hits++;
    else if (r === "miss") misses++;
    else flats++;
  }
  const decided = hits + misses;
  return {
    hits,
    misses,
    flats,
    rate: decided > 0 ? hits / decided : NaN,
    rateWithFlats: obs.length > 0 ? hits / obs.length : NaN,
  };
}

/** Gross bps captured per observation, before cost. */
function grossBps(obs: Observation[]): number {
  return obs.reduce((sum, o) => sum + (Math.sign(o.forwardBps) !== Math.sign(o.triggerBps) ? 1 : -1) * Math.abs(o.forwardBps), 0);
}

function pct(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "—";
}

function main(): void {
  const bars = parseMt5Export(readFileSync(FILE, "utf8"), { serverOffsetHours: SERVER_OFFSET }).bars;
  const all = build(bars).filter((o) => Number.isFinite(o.trailingMedian));

  const cut = Math.floor(bars.length * IN_SAMPLE_FRACTION);
  const inSample = all.filter((o) => o.index < cut);
  const holdout = all.filter((o) => o.index >= cut);

  const spreadBps = spreadPointsToBps(SPREAD_POINTS, POINT_SIZE, bars[Math.floor(bars.length / 2)].close);

  console.log(`\n${"=".repeat(76)}`);
  console.log("HYPOTHESIS 3 — five-minute reversion after absorption, XAUUSD");
  console.log("Run under EVIDENCE_PROTOCOL_3.md, committed before this script existed.");
  console.log("=".repeat(76));
  console.log(`\n${bars.length.toLocaleString()} M1 bars -> ${all.length.toLocaleString()} non-overlapping 5-minute observations`);
  console.log(`in-sample ${inSample.length.toLocaleString()}   holdout ${holdout.length.toLocaleString()} (NOT touched below)`);
  console.log(`round-trip spread ${spreadBps.toFixed(3)} bps, from ${SPREAD_POINTS} points at ${bars[Math.floor(bars.length / 2)].close}`);

  // ---- P1 ---------------------------------------------------------------
  const triggered = inSample.filter((o) => Math.abs(o.triggerBps) > o.trailingMedian);
  const r = rate(triggered);
  console.log(`\n--- P1: raw reversion hit rate  (threshold ${pct(P1_THRESHOLD)}) ---`);
  console.log(`  triggered observations: ${triggered.length.toLocaleString()} of ${inSample.length.toLocaleString()} in-sample (${pct(triggered.length / inSample.length)} fire rate)`);
  console.log(`  hits ${r.hits.toLocaleString()}   misses ${r.misses.toLocaleString()}   flat ${r.flats.toLocaleString()}`);
  console.log(`  HIT RATE ${pct(r.rate)}  (counting flats as losses: ${pct(r.rateWithFlats)})`);
  const se = Math.sqrt(0.25 / (r.hits + r.misses));
  console.log(`  standard error ${pct(se)};  ${((r.rate - 0.5) / se).toFixed(2)} SE from a coin flip`);
  const p1 = r.rate >= P1_THRESHOLD;
  console.log(`  P1: ${p1 ? "PASSES" : "FAILS"}`);

  // ---- P2 ---------------------------------------------------------------
  const sorted = [...inSample].sort((a, b) => Math.abs(a.triggerBps) - Math.abs(b.triggerBps));
  const q = (f: number) => Math.abs(sorted[Math.floor(f * sorted.length)].triggerBps);
  const p50 = q(0.5);
  const p80 = q(0.8);
  const band = inSample.filter((o) => Math.abs(o.triggerBps) > p50 && Math.abs(o.triggerBps) <= p80);
  const tail = inSample.filter((o) => Math.abs(o.triggerBps) > p80);
  const rb = rate(band);
  const rt = rate(tail);
  console.log(`\n--- P2: does the effect scale with the size of the absorbed order? ---`);
  console.log(`  50th-80th percentile (${band.length.toLocaleString()} obs): ${pct(rb.rate)}`);
  console.log(`  top quintile         (${tail.length.toLocaleString()} obs): ${pct(rt.rate)}`);
  const p2 = rt.rate > rb.rate;
  console.log(`  P2: ${p2 ? "PASSES" : "FAILS"}  (underpowered 1.4x by protocol §6 — weak evidence either way)`);

  // ---- P3 ---------------------------------------------------------------
  // Same construction at a 1-minute horizon, to see whether this is quote bounce.
  const times = bars.map((b) => Date.parse(b.time));
  const closes = bars.map((b) => b.close);
  let h1 = 0;
  let m1 = 0;
  for (let i = 1; i + 1 < cut; i += 1) {
    if (times[i] - times[i - 1] !== 60_000 || times[i + 1] - times[i] !== 60_000) continue;
    const t = closes[i] / closes[i - 1] - 1;
    const f = closes[i + 1] / closes[i] - 1;
    if (t === 0 || f === 0) continue;
    if (Math.sign(f) !== Math.sign(t)) h1++;
    else m1++;
  }
  const rate1 = h1 / (h1 + m1);
  console.log(`\n--- P3: is this quote bounce rather than inventory? ---`);
  console.log(`  1-minute reversion rate, all bars: ${pct(rate1)} over ${(h1 + m1).toLocaleString()} obs`);
  console.log(`  5-minute reversion rate, triggered: ${pct(r.rate)}`);
  const p3 = !(rate1 > r.rate + 0.05);
  console.log(`  P3: ${p3 ? "PASSES" : "FAILS"}  (fails if 1m dwarfs 5m, the signature of bounce)`);

  // ---- P4 ---------------------------------------------------------------
  const byHour = new Map<number, Observation[]>();
  for (const o of triggered) {
    const b = byHour.get(o.hour);
    if (b) b.push(o);
    else byHour.set(o.hour, [o]);
  }
  const totalEdge = triggered.reduce((s, o) => s + (outcome(o) === "hit" ? 1 : 0), 0) - 0.5 * (r.hits + r.misses);
  let worstShare = 0;
  let worstHour = -1;
  for (const [hour, obs] of byHour) {
    const rr = rate(obs);
    const edge = rr.hits - 0.5 * (rr.hits + rr.misses);
    const share = totalEdge !== 0 ? edge / totalEdge : 0;
    if (share > worstShare) {
      worstShare = share;
      worstHour = hour;
    }
  }
  const mid = triggered[Math.floor(triggered.length / 2)].time;
  const firstHalf = rate(triggered.filter((o) => o.time < mid));
  const secondHalf = rate(triggered.filter((o) => o.time >= mid));
  console.log(`\n--- P4: is it concentrated in one hour or one fortnight? ---`);
  console.log(`  largest single-hour share of the total edge: ${pct(worstShare)} (hour ${worstHour} UTC)`);
  console.log(`  first half ${pct(firstHalf.rate)}   second half ${pct(secondHalf.rate)}`);
  const p4 = worstShare <= 0.25 && firstHalf.rate > 0.5 && secondHalf.rate > 0.5;
  console.log(`  P4: ${p4 ? "PASSES" : "FAILS"}`);

  // ---- P5 ---------------------------------------------------------------
  const gross = grossBps(triggered);
  const cost = triggered.length * spreadBps;
  console.log(`\n--- P5: does it survive the measured spread? ---`);
  console.log(`  gross ${gross.toFixed(1)} bps over ${triggered.length.toLocaleString()} trades (${(gross / triggered.length).toFixed(4)} bps/trade)`);
  console.log(`  cost  ${cost.toFixed(1)} bps (${spreadBps.toFixed(3)} bps/trade)`);
  const net = gross - cost;
  console.log(`  NET   ${net.toFixed(1)} bps  (${(net / triggered.length).toFixed(4)} bps/trade)`);
  const p5 = net > 0;
  console.log(`  P5: ${p5 ? "PASSES" : "FAILS"}`);

  console.log(`\n${"=".repeat(76)}`);
  const results = [["P1", p1], ["P2", p2], ["P3", p3], ["P4", p4], ["P5", p5]] as const;
  console.log("  " + results.map(([k, v]) => `${k} ${v ? "pass" : "FAIL"}`).join("   "));
  console.log(`\n  VERDICT: hypothesis 3 is ${p1 ? "not falsified by P1" : "FALSIFIED"} in-sample.`);
  console.log(`  Holdout (${holdout.length.toLocaleString()} observations) was not touched.`);
  console.log("=".repeat(76) + "\n");
}

main();
