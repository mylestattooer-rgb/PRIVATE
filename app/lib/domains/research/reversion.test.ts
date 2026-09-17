import { describe, expect, it } from "vitest";
import type { Mt5Bar } from "./mt5-import";
import { buildObservations, grossBps, hitRate, isReversal, type Observation } from "./reversion";

/** Minute bars from a list of closes, starting at `start`. */
function series(start: string, closes: number[]): Mt5Bar[] {
  const t0 = Date.parse(start);
  return closes.map((c, i) => ({
    time: new Date(t0 + i * 60_000).toISOString(),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    spreadPoints: 10,
  }));
}

function obs(triggerBps: number, forwardBps: number): Observation {
  return { index: 0, time: 0, hour: 0, triggerBps, forwardBps, trailingMedian: 0 };
}

describe("buildObservations", () => {
  it("steps by the horizon so forward windows never overlap", () => {
    // 21 bars, horizon 5 -> decision bars at 5, 10, 15 (20 has no forward window).
    const built = buildObservations(series("2024-01-02T09:00:00.000Z", Array.from({ length: 21 }, (_, i) => 100 + i)), {
      horizon: 5,
      trailingMinutes: 1000,
    });
    expect(built.map((o) => o.index)).toEqual([5, 10, 15]);

    // Adjacent, not overlapping: each forward window starts where the last ended.
    for (let i = 1; i < built.length; i++) {
      expect(built[i].index - built[i - 1].index).toBe(5);
    }
  });

  it("measures the trigger backwards and the forward return forwards", () => {
    // Flat at 100 for five bars, then a step to 110, then back to 99.
    const closes = [100, 100, 100, 100, 100, 110, 110, 110, 110, 110, 99];
    const [o] = buildObservations(series("2024-01-02T09:00:00.000Z", closes), { horizon: 5, trailingMinutes: 1000 });

    expect(o.index).toBe(5);
    expect(o.triggerBps).toBeCloseTo((110 / 100 - 1) * 10_000, 6); // +1000 bps in
    expect(o.forwardBps).toBeCloseTo((99 / 110 - 1) * 10_000, 6); // -1000 bps out
    expect(isReversal(o)).toBe(true);
  });

  it("drops windows that straddle a session gap", () => {
    // Ten contiguous minutes, a weekend, then ten more. The jump across the gap
    // is not a move any five-minute strategy could have traded.
    const before = series("2024-01-05T20:00:00.000Z", [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const after = series("2024-01-08T09:00:00.000Z", [130, 130, 130, 130, 130, 130, 130, 130, 130, 130]);
    const built = buildObservations([...before, ...after], { horizon: 5, trailingMinutes: 100_000 });

    // No observation may report the 100 -> 130 jump.
    for (const o of built) {
      expect(Math.abs(o.triggerBps)).toBeLessThan(100);
      expect(Math.abs(o.forwardBps)).toBeLessThan(100);
    }
  });

  it("computes the trailing median causally, never from the whole sample", () => {
    // Quiet first, then violent. An observation early in the series must not
    // see the later volatility — using the full-sample median is look-ahead,
    // and on the real gold series it flattered the result by 0.15 points.
    const quiet = Array.from({ length: 300 }, (_, i) => 100 + (i % 2) * 0.01);
    const violent = Array.from({ length: 300 }, (_, i) => 100 + (i % 2) * 5);
    const built = buildObservations(series("2024-01-02T00:00:00.000Z", [...quiet, ...violent]), {
      horizon: 5,
      trailingMinutes: 200,
      minTrailing: 5,
    });

    const early = built.find((o) => o.index === 100)!;
    const late = built[built.length - 1];
    expect(Number.isFinite(early.trailingMedian)).toBe(true);
    // The early observation's window is entirely inside the quiet stretch.
    expect(early.trailingMedian).toBeLessThan(late.trailingMedian);
  });

  it("reports NaN for a trailing median with too little history", () => {
    const built = buildObservations(series("2024-01-02T09:00:00.000Z", Array.from({ length: 40 }, () => 100 + Math.random())), {
      horizon: 5,
      trailingMinutes: 1000,
      minTrailing: 20,
    });
    expect(Number.isNaN(built[0].trailingMedian)).toBe(true);
  });

  it("handles degenerate input", () => {
    expect(buildObservations([], { horizon: 5, trailingMinutes: 100 })).toEqual([]);
    expect(buildObservations(series("2024-01-02T09:00:00.000Z", [1, 2, 3]), { horizon: 5, trailingMinutes: 100 })).toEqual([]);
    expect(buildObservations(series("2024-01-02T09:00:00.000Z", [1, 2, 3]), { horizon: 0, trailingMinutes: 100 })).toEqual([]);
  });
});

describe("hitRate", () => {
  it("recovers a known reversion rate exactly", () => {
    // The test that would have caught a miscount: seven reversals and three
    // continuations, constructed by hand.
    const built = [
      ...Array.from({ length: 7 }, () => obs(10, -10)),
      ...Array.from({ length: 3 }, () => obs(10, 10)),
    ];
    const r = hitRate(built);
    expect(r.hits).toBe(7);
    expect(r.misses).toBe(3);
    expect(r.rate).toBeCloseTo(0.7, 10);
  });

  it("counts a flat forward return separately, and as a loss when asked", () => {
    // Zero earns nothing and still pays the spread, so it is not a win.
    const r = hitRate([obs(10, -10), obs(10, 10), obs(10, 0)]);
    expect(r.hits).toBe(1);
    expect(r.misses).toBe(1);
    expect(r.flats).toBe(1);
    expect(r.rate).toBeCloseTo(0.5, 10); // over decided outcomes
    expect(r.rateWithFlats).toBeCloseTo(1 / 3, 10);
  });

  it("gives a standard error over decided outcomes, not over all of them", () => {
    const r = hitRate(Array.from({ length: 100 }, (_, i) => obs(10, i < 50 ? -10 : 10)));
    expect(r.standardError).toBeCloseTo(Math.sqrt(0.25 / 100), 10);
  });

  it("returns NaN rather than a fabricated rate when nothing was decided", () => {
    expect(Number.isNaN(hitRate([]).rate)).toBe(true);
    expect(Number.isNaN(hitRate([obs(10, 0)]).rate)).toBe(true);
  });

  it("treats a down-move followed by an up-move as a reversal too", () => {
    expect(hitRate([obs(-10, 10)]).hits).toBe(1);
    expect(hitRate([obs(-10, -10)]).misses).toBe(1);
  });
});

describe("grossBps", () => {
  it("credits the full move on a reversal and debits it on a continuation", () => {
    expect(grossBps([obs(10, -4)])).toBeCloseTo(4, 10);
    expect(grossBps([obs(10, 4)])).toBeCloseTo(-4, 10);
    expect(grossBps([obs(10, -4), obs(10, 4)])).toBeCloseTo(0, 10);
  });

  it("can be negative even at a hit rate above half, when the misses are bigger", () => {
    // Two small wins and one large loss: 60%+ hit rate, negative expectancy.
    // The reason a hit rate alone never settles anything.
    const built = [obs(10, -1), obs(10, -1), obs(10, 5)];
    expect(hitRate(built).rate).toBeCloseTo(2 / 3, 10);
    expect(grossBps(built)).toBeCloseTo(-3, 10);
  });

  it("is zero for an empty set", () => {
    expect(grossBps([])).toBe(0);
  });
});
