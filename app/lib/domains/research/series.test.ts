import { describe, expect, it } from "vitest";
import { alignSeries, barsPerYear, realisedVol, simpleReturns, trailingReturn } from "./series";

describe("alignSeries", () => {
  const input = {
    // Weekday instrument, misses the weekend.
    FX: [
      { date: "2026-01-02", close: 100 },
      { date: "2026-01-05", close: 102 },
    ],
    // Every-day instrument.
    CRYPTO: [
      { date: "2026-01-02", close: 10 },
      { date: "2026-01-03", close: 11 },
      { date: "2026-01-04", close: 12 },
      { date: "2026-01-05", close: 13 },
    ],
  };

  it("uses the union of all dates so no activity is discarded", () => {
    expect(alignSeries(input).dates).toEqual(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  it("carries a price forward on days an instrument did not trade", () => {
    const { prices } = alignSeries(input);
    expect(prices.FX).toEqual([100, 100, 100, 102]);
  });

  it("makes a non-trading day a zero return, not a fabricated move", () => {
    const { prices } = alignSeries(input);
    expect(simpleReturns(prices.FX)).toEqual([null, 0, 0, 102 / 100 - 1]);
  });

  it("leaves null before an instrument's first observation rather than back-filling", () => {
    const { prices } = alignSeries({
      OLD: [
        { date: "2026-01-02", close: 1 },
        { date: "2026-01-03", close: 2 },
      ],
      NEW: [{ date: "2026-01-03", close: 50 }],
    });
    // Back-filling would let a strategy hold something that did not yet exist.
    expect(prices.NEW).toEqual([null, 50]);
  });

  it("sorts symbols for a stable column order", () => {
    expect(alignSeries({ ZZZ: [], AAA: [] }).symbols).toEqual(["AAA", "ZZZ"]);
  });
});

describe("simpleReturns", () => {
  it("is null for the first bar and for any gap", () => {
    const out = simpleReturns([null, 100, 110]);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(0.1, 10);
  });

  it("computes a simple period return", () => {
    expect(simpleReturns([100, 110])[1]).toBeCloseTo(0.1, 10);
  });
});

describe("realisedVol", () => {
  const flat = Array.from({ length: 100 }, () => 0);

  it("returns null rather than a vol estimate from a partial window", () => {
    expect(realisedVol([null, 0.01, 0.02], 60, 2, 252)).toBeNull();
  });

  it("returns null when any return in the window is missing", () => {
    const withGap: (number | null)[] = [...flat];
    withGap[50] = null;
    expect(realisedVol(withGap, 60, 80, 252)).toBeNull();
  });

  it("is zero for a perfectly flat series", () => {
    expect(realisedVol(flat, 60, 80, 252)).toBe(0);
  });

  it("annualises by the square root of periods per year", () => {
    const alternating = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const daily = realisedVol(alternating, 60, 80, 1)!;
    const annual = realisedVol(alternating, 60, 80, 252)!;
    expect(annual / daily).toBeCloseTo(Math.sqrt(252), 6);
  });
});

describe("trailingReturn", () => {
  const prices = Array.from({ length: 300 }, (_, i) => 100 + i);

  it("measures from exactly `lookback` bars back", () => {
    expect(trailingReturn(prices, 252, 299)).toBeCloseTo(399 / 147 - 1, 10);
  });

  it("returns null when there is not enough history", () => {
    expect(trailingReturn(prices, 252, 100)).toBeNull();
  });
});

describe("barsPerYear", () => {
  const daily = (count: number, stepDays: number) =>
    Array.from({ length: count }, (_, i) =>
      new Date(Date.UTC(2020, 0, 1) + i * stepDays * 86_400_000).toISOString().slice(0, 10),
    );

  it("measures a 7-day calendar at about 365", () => {
    expect(barsPerYear(daily(700, 1))).toBeCloseTo(365.25, 0);
  });

  it("measures a 5-day calendar well below 365", () => {
    // Weekdays only: roughly 260 a year.
    const weekdays: string[] = [];
    for (let i = 0; weekdays.length < 500; i++) {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) weekdays.push(d.toISOString().slice(0, 10));
    }
    const measured = barsPerYear(weekdays);
    expect(measured).toBeGreaterThan(250);
    expect(measured).toBeLessThan(270);
  });

  it("falls back to 252 when there is nothing to measure", () => {
    expect(barsPerYear([])).toBe(252);
    expect(barsPerYear(["2020-01-01"])).toBe(252);
  });
});
