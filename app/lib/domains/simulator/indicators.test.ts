import { describe, expect, it } from "vitest";
import { atr, crossedAbove, crossedBelow, sma, trueRange } from "./indicators";
import type { Bar } from "./types";

const bar = (close: number, high = close + 1, low = close - 1): Bar => ({
  time: "2026-01-01T00:00:00.000Z",
  open: close,
  high,
  low,
  close,
  volume: 1000,
});

describe("sma", () => {
  it("averages the trailing window only", () => {
    expect(sma([1, 2, 3, 100, 200], 2)).toBe(150);
  });

  it("returns null rather than a short-window average", () => {
    expect(sma([1, 2], 5)).toBeNull();
    expect(sma([], 1)).toBeNull();
  });

  it("returns null for a non-positive period", () => {
    expect(sma([1, 2, 3], 0)).toBeNull();
  });
});

describe("trueRange", () => {
  it("is the high-low range when there is no previous close", () => {
    expect(trueRange(bar(10, 12, 8), null)).toBe(4);
  });

  it("accounts for a gap above the previous close", () => {
    expect(trueRange(bar(20, 21, 19), 10)).toBe(11);
  });

  it("accounts for a gap below the previous close", () => {
    expect(trueRange(bar(5, 6, 4), 15)).toBe(11);
  });
});

describe("atr", () => {
  it("needs period + 1 bars", () => {
    expect(atr([bar(10), bar(10)], 3)).toBeNull();
    expect(atr([bar(10), bar(10), bar(10), bar(10)], 3)).not.toBeNull();
  });

  it("averages true range over the trailing window", () => {
    // Each bar spans 2 and closes where the previous did, so every TR is 2.
    const bars = [bar(10), bar(10), bar(10), bar(10)];
    expect(atr(bars, 3)).toBe(2);
  });
});

describe("crossedAbove / crossedBelow", () => {
  it("fires only on the bar the cross happens", () => {
    expect(crossedAbove(11, 10, 9, 10)).toBe(true);
    expect(crossedAbove(12, 10, 11, 10)).toBe(false);
  });

  it("treats an equal previous bar as not yet crossed", () => {
    expect(crossedAbove(11, 10, 10, 10)).toBe(true);
    expect(crossedBelow(9, 10, 10, 10)).toBe(true);
  });

  it("does not fire when two flat equal series stay equal", () => {
    expect(crossedAbove(10, 10, 10, 10)).toBe(false);
    expect(crossedBelow(10, 10, 10, 10)).toBe(false);
  });
});
