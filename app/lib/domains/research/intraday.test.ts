import { describe, expect, it } from "vitest";
import type { Mt5Bar } from "./mt5-import";
import { breakEvenHitRate, classify, hourlyProfile } from "./intraday";

function bar(time: string, close: number, spreadPoints: number | null): Mt5Bar {
  return { time, open: close, high: close, low: close, close, volume: 1, spreadPoints };
}

/** A run of consecutive minute bars starting at `start`, closing at each price. */
function minutes(start: string, closes: number[], spreadPoints: number | null = 10): Mt5Bar[] {
  const t0 = Date.parse(start);
  return closes.map((c, i) => bar(new Date(t0 + i * 60_000).toISOString(), c, spreadPoints));
}

describe("breakEvenHitRate", () => {
  it("is a coin flip when trading is free", () => {
    expect(breakEvenHitRate(0, 10)).toBe(0.5);
  });

  it("rises with cost and falls with the size of the move", () => {
    // Need to capture half the spread out of each unit of move, above even.
    expect(breakEvenHitRate(1, 10)).toBeCloseTo(0.55, 10);
    expect(breakEvenHitRate(1, 50)).toBeCloseTo(0.51, 10);
    expect(breakEvenHitRate(2, 10)).toBeCloseTo(0.6, 10);
  });

  it("exceeds 1 when the spread is wider than the move, which is the point", () => {
    // Not a near miss. A probability cannot exceed 1, so no signal of any
    // quality pays for this spread at this horizon.
    expect(breakEvenHitRate(30, 10)).toBeGreaterThan(1);
  });

  it("is infinite on an instrument that does not move", () => {
    expect(breakEvenHitRate(1, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("classify", () => {
  it("separates arithmetic impossibility from mere implausibility", () => {
    expect(classify(1.4)).toBe("impossible");
    expect(classify(Number.POSITIVE_INFINITY)).toBe("impossible");
    expect(classify(0.8)).toBe("implausible");
    expect(classify(0.56)).toBe("implausible");
    expect(classify(0.53)).toBe("demanding");
    expect(classify(0.51)).toBe("affordable");
  });

  it("puts the boundaries where the doc comment says they are", () => {
    expect(classify(0.55)).toBe("demanding");
    expect(classify(0.52)).toBe("affordable");
    expect(classify(1)).toBe("implausible");
  });
});

describe("hourlyProfile", () => {
  it("buckets by UTC hour and measures forward moves from it", () => {
    // 09:00 UTC, six minutes, +10 bps per minute on a price of 100.
    const closes = [100, 100.1, 100.2, 100.3, 100.4, 100.5];
    const profile = hourlyProfile(minutes("2024-01-02T09:00:00.000Z", closes), 0.01, [1]);

    expect(profile).toHaveLength(1);
    expect(profile[0].hour).toBe(9);
    expect(profile[0].bars).toBe(6);
    // Five one-minute windows fit in six bars.
    expect(profile[0].horizons[0].samples).toBe(5);
    expect(profile[0].horizons[0].meanAbsMoveBps).toBeGreaterThan(9);
    expect(profile[0].horizons[0].meanAbsMoveBps).toBeLessThan(11);
  });

  it("discards windows that straddle a session gap", () => {
    // Friday close then Monday open, with a large weekend jump between them.
    const friday = minutes("2024-01-05T20:00:00.000Z", [100, 100.01, 100.02]);
    const monday = minutes("2024-01-08T09:00:00.000Z", [130, 130.01, 130.02]);
    const profile = hourlyProfile([...friday, ...monday], 0.01, [1]);

    const hour20 = profile.find((p) => p.hour === 20)!;
    // Two windows inside Friday, and the weekend jump is not one of them.
    expect(hour20.horizons[0].samples).toBe(2);
    expect(hour20.horizons[0].meanAbsMoveBps).toBeLessThan(2);
  });

  it("excludes zero and missing spreads, and reports the share", () => {
    const bars = [
      bar("2024-01-02T09:00:00.000Z", 100, 10),
      bar("2024-01-02T09:01:00.000Z", 100, 0), // missing, not free
      bar("2024-01-02T09:02:00.000Z", 100, null), // no cell at all
      bar("2024-01-02T09:03:00.000Z", 100, 30),
    ];
    const [hour] = hourlyProfile(bars, 0.01, [1]);

    expect(hour.bars).toBe(4);
    expect(hour.spreadSamples).toBe(2);
    expect(hour.missingSpreadShare).toBeCloseTo(0.5, 10);
    // Median over {10, 30} points at a price of 100 — not dragged to zero.
    expect(hour.medianSpreadBps).toBeGreaterThan(0);
  });

  it("reports each hour separately rather than pooling the day", () => {
    // A quiet hour and a volatile one, same spread. The whole purpose is that
    // these must not collapse into one number.
    const quiet = minutes("2024-01-02T03:00:00.000Z", [100, 100.001, 100.002, 100.003], 1);
    const busy = minutes("2024-01-02T13:00:00.000Z", [100, 101, 102, 103], 1);
    const profile = hourlyProfile([...quiet, ...busy], 0.01, [1]);

    const h3 = profile.find((p) => p.hour === 3)!;
    const h13 = profile.find((p) => p.hour === 13)!;
    expect(h13.horizons[0].meanAbsMoveBps).toBeGreaterThan(h3.horizons[0].meanAbsMoveBps * 100);

    // Identical spread, wildly different required hit rate — the whole point of
    // profiling by hour instead of quoting one median for the day.
    // Not exactly equal: the same point spread converts at each bar's own
    // close, and the busy hour's price rises 3% across it. Within 1%.
    expect(h3.medianSpreadBps).toBeCloseTo(h13.medianSpreadBps, 1);
    const cheap = breakEvenHitRate(h13.medianSpreadBps, h13.horizons[0].meanAbsMoveBps);
    const dear = breakEvenHitRate(h3.medianSpreadBps, h3.horizons[0].meanAbsMoveBps);
    expect(classify(cheap)).toBe("affordable");
    expect(classify(dear)).toBe("impossible");
  });

  it("carries the median alongside the mean, since they diverge on fat tails", () => {
    // One 100 bps minute among flat ones: the mean is set by it, the median is not.
    const closes = [100, 100, 100, 100, 101, 101, 101, 101];
    const [hour] = hourlyProfile(minutes("2024-01-02T09:00:00.000Z", closes), 0.01, [1]);
    expect(hour.horizons[0].meanAbsMoveBps).toBeGreaterThan(hour.horizons[0].medianAbsMoveBps * 5);
    expect(hour.horizons[0].medianAbsMoveBps).toBe(0);
  });

  it("handles an empty series and a nonsense point size", () => {
    expect(hourlyProfile([], 0.01)).toEqual([]);
    expect(hourlyProfile(minutes("2024-01-02T09:00:00.000Z", [1, 2]), 0)).toEqual([]);
  });
});
