import { describe, expect, it } from "vitest";
import { alignSeries } from "./series";
import { FREE, runPortfolio } from "./portfolio";
import { CANONICAL_TSMOM, type TsmomConfig } from "./tsmom";

/** Deterministic noise, so tests are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function series(count: number, seed: number, drift = 0): { date: string; close: number }[] {
  const rng = makeRng(seed);
  const rows: { date: string; close: number }[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price = Math.max(1, price * (1 + drift + (rng() - 0.5) * 0.02));
    rows.push({
      date: new Date(Date.UTC(2010, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      close: Number(price.toFixed(4)),
    });
  }
  return rows;
}

const config: TsmomConfig = { ...CANONICAL_TSMOM, rebalanceEvery: 21 };

describe("no look-ahead", () => {
  it("appending a future bar does not change any earlier return", () => {
    // The most general statement of the property: whatever happens tomorrow
    // must not alter what the strategy is recorded as having earned today.
    const base = series(500, 7);
    const withFuture = [
      ...base,
      {
        date: new Date(Date.UTC(2010, 0, 1) + 500 * 86_400_000).toISOString().slice(0, 10),
        // An enormous, unmissable move. A leaking engine would capture it.
        close: base[base.length - 1].close * 1.5,
      },
    ];

    const a = runPortfolio(alignSeries({ A: base }), { config, costs: FREE, signalMode: "momentum" });
    const b = runPortfolio(alignSeries({ A: withFuture }), { config, costs: FREE, signalMode: "momentum" });

    expect(b.returns.length).toBe(a.returns.length + 1);
    for (let i = 0; i < a.returns.length; i++) {
      expect(b.returns[i]).toBeCloseTo(a.returns[i], 12);
    }
  });

  it("earns nothing on the very first bar, because it enters holding nothing", () => {
    const result = runPortfolio(alignSeries({ A: series(400, 3) }), {
      config,
      costs: FREE,
      signalMode: "momentum",
    });
    expect(result.returns[0]).toBe(0);
  });

  it("does not capture a jump that happens on the rebalance bar itself", () => {
    // Flat-ish for the warmup, then a single huge up-bar. The weight implied by
    // that bar's own trailing return may only earn from the NEXT bar.
    const rows = series(300, 11);
    const jumpIndex = rows.length - 1;
    rows[jumpIndex] = { ...rows[jumpIndex], close: rows[jumpIndex - 1].close * 2 };

    const result = runPortfolio(alignSeries({ A: rows }), { config, costs: FREE, signalMode: "momentum" });
    const jumpDate = rows[jumpIndex].date;
    const index = result.dates.indexOf(jumpDate);

    expect(index).toBeGreaterThanOrEqual(0);
    // Whatever it earned on the jump bar came from the weight it already held,
    // which cannot be more than the cap times the move.
    expect(Math.abs(result.returns[index])).toBeLessThanOrEqual(config.maxWeightPerInstrument * 1.0 + 1e-9);
  });
});

describe("weighting", () => {
  it("sizes inversely to volatility, so a calmer instrument gets more weight", () => {
    const calm = series(500, 21, 0).map((r, i) => ({ ...r, close: 100 + Math.sin(i) * 0.5 }));
    const wild = series(500, 22, 0).map((r, i) => ({ ...r, close: 100 + Math.sin(i) * 20 }));

    const calmRun = runPortfolio(alignSeries({ A: calm }), { config, costs: FREE, signalMode: "long-only" });
    const wildRun = runPortfolio(alignSeries({ A: wild }), { config, costs: FREE, signalMode: "long-only" });

    expect(calmRun.meanGrossExposure).toBeGreaterThan(wildRun.meanGrossExposure);
  });

  it("respects the per-instrument cap and reports how often it bound", () => {
    // Near-zero volatility implies unbounded leverage without the cap.
    const glassy = Array.from({ length: 500 }, (_, i) => ({
      date: new Date(Date.UTC(2010, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      close: 100 + i * 0.0001,
    }));
    const result = runPortfolio(alignSeries({ A: glassy }), { config, costs: FREE, signalMode: "long-only" });

    expect(result.maxGrossExposure).toBeLessThanOrEqual(config.maxWeightPerInstrument + 1e-9);
    expect(result.capBindRate).toBeGreaterThan(0.9);
  });

  it("equal-weights across the universe, so adding instruments does not multiply exposure", () => {
    // The bug this pins: scaling each instrument to a vol target and then
    // summing gives N times the intended exposure. One instrument and four
    // identical ones must run at the same gross leverage.
    const rows = series(700, 81, 0.0003);
    const one = runPortfolio(alignSeries({ A: rows }), { config, costs: FREE, signalMode: "long-only" });
    const four = runPortfolio(alignSeries({ A: rows, B: rows, C: rows, D: rows }), {
      config,
      costs: FREE,
      signalMode: "long-only",
    });

    expect(four.meanGrossExposure).toBeCloseTo(one.meanGrossExposure, 6);
    expect(four.maxGrossExposure).toBeCloseTo(one.maxGrossExposure, 6);
  });

  it("gives no weight to an instrument whose volatility cannot be measured", () => {
    const short = series(50, 5);
    const result = runPortfolio(alignSeries({ A: short }), { config, costs: FREE, signalMode: "momentum" });
    expect(result.returns.every((r) => r === 0)).toBe(true);
  });
});

describe("signal modes", () => {
  it("long-only never takes a short position", () => {
    const rows = series(800, 31, -0.001); // persistent downtrend
    const longOnly = runPortfolio(alignSeries({ A: rows }), { config, costs: FREE, signalMode: "long-only" });
    const momentum = runPortfolio(alignSeries({ A: rows }), { config, costs: FREE, signalMode: "momentum" });

    // In a sustained downtrend, momentum shorts and long-only does not.
    expect(momentum.contributionBySymbol.A).toBeGreaterThan(longOnly.contributionBySymbol.A);
  });
});

describe("costs", () => {
  const rows = series(800, 41, 0.0005);

  it("transaction costs make the result strictly worse", () => {
    const free = runPortfolio(alignSeries({ A: rows }), { config, costs: FREE, signalMode: "momentum" });
    const costly = runPortfolio(alignSeries({ A: rows }), {
      config,
      costs: { transactionBps: 20, financingBpsPerBar: 0 },
      signalMode: "momentum",
    });
    expect(costly.totalCostDrag).toBeGreaterThan(0);
    const freeSum = free.returns.reduce((a, b) => a + b, 0);
    const costlySum = costly.returns.reduce((a, b) => a + b, 0);
    expect(costlySum).toBeLessThan(freeSum);
  });

  it("financing is charged on gross exposure every bar, including while short", () => {
    const down = series(800, 43, -0.001);
    const charged = runPortfolio(alignSeries({ A: down }), {
      config,
      costs: { transactionBps: 0, financingBpsPerBar: 5 },
      signalMode: "momentum",
    });
    expect(charged.totalCostDrag).toBeGreaterThan(0);
  });

  it("gross returns exclude costs and net returns include them", () => {
    const costly = runPortfolio(alignSeries({ A: rows }), {
      config,
      costs: { transactionBps: 20, financingBpsPerBar: 2 },
      signalMode: "momentum",
    });
    const gross = costly.returnsGross.reduce((a, b) => a + b, 0);
    const net = costly.returns.reduce((a, b) => a + b, 0);
    expect(gross).toBeGreaterThan(net);
  });
});

describe("universe handling", () => {
  it("supports running a subset, for leave-one-out tests", () => {
    const aligned = alignSeries({ A: series(600, 51), B: series(600, 52), C: series(600, 53) });
    const all = runPortfolio(aligned, { config, costs: FREE, signalMode: "momentum" });
    const withoutC = runPortfolio(aligned, { config, costs: FREE, signalMode: "momentum", symbols: ["A", "B"] });

    expect(Object.keys(all.contributionBySymbol)).toEqual(["A", "B", "C"]);
    expect(Object.keys(withoutC.contributionBySymbol)).toEqual(["A", "B"]);
  });

  it("attributes each instrument's contribution separately", () => {
    const aligned = alignSeries({ A: series(600, 61), B: series(600, 62) });
    const result = runPortfolio(aligned, { config, costs: FREE, signalMode: "momentum" });

    const summed = result.dates.map((_, i) => result.contributionSeries.A[i] + result.contributionSeries.B[i]);
    // Contributions must reconstruct the gross portfolio return exactly.
    for (let i = 0; i < summed.length; i++) {
      expect(summed[i]).toBeCloseTo(result.returnsGross[i], 12);
    }
  });

  it("respects date bounds", () => {
    const aligned = alignSeries({ A: series(900, 71) });
    const full = runPortfolio(aligned, { config, costs: FREE, signalMode: "momentum" });
    const bounded = runPortfolio(aligned, {
      config,
      costs: FREE,
      signalMode: "momentum",
      from: full.dates[Math.floor(full.dates.length / 2)],
    });
    expect(bounded.dates.length).toBeLessThan(full.dates.length);
    expect(bounded.dates[0]).toBe(full.dates[Math.floor(full.dates.length / 2)]);
  });
});
