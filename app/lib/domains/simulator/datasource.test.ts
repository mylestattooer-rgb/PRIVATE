import { describe, expect, it } from "vitest";
import { assertValidSeries, createInMemoryDataSource, isValidBar, parseCsvBars } from "./datasource";
import type { Bar } from "./types";

const bar = (overrides: Partial<Bar> = {}): Bar => ({
  time: "2026-01-01T00:00:00.000Z",
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: 1_000,
  ...overrides,
});

describe("isValidBar", () => {
  it("accepts a well-formed bar", () => {
    expect(isValidBar(bar())).toBe(true);
  });

  it("rejects a high below the open or close", () => {
    expect(isValidBar(bar({ high: 101 }))).toBe(false);
  });

  it("rejects a low above the open or close", () => {
    expect(isValidBar(bar({ low: 101 }))).toBe(false);
  });

  it("rejects non-positive and non-finite prices", () => {
    expect(isValidBar(bar({ low: 0 }))).toBe(false);
    expect(isValidBar(bar({ close: Number.NaN }))).toBe(false);
  });

  it("rejects negative volume and unparseable timestamps", () => {
    expect(isValidBar(bar({ volume: -1 }))).toBe(false);
    expect(isValidBar(bar({ time: "not a date" }))).toBe(false);
  });

  it("accepts a zero-volume bar, which is unusual but not malformed", () => {
    expect(isValidBar(bar({ volume: 0 }))).toBe(true);
  });
});

describe("assertValidSeries", () => {
  it("rejects duplicate timestamps", () => {
    expect(() => assertValidSeries([bar(), bar()], "src")).toThrow(/out-of-order or duplicate/);
  });

  it("rejects bars that go backwards in time", () => {
    const series = [bar({ time: "2026-01-02T00:00:00.000Z" }), bar({ time: "2026-01-01T00:00:00.000Z" })];
    expect(() => assertValidSeries(series, "src")).toThrow(/out-of-order/);
  });

  it("names the offending source and index", () => {
    expect(() => assertValidSeries([bar({ high: 1 })], "vendor:AAPL")).toThrow(/vendor:AAPL: bar 0/);
  });

  it("accepts an empty series", () => {
    expect(() => assertValidSeries([], "src")).not.toThrow();
  });
});

describe("createInMemoryDataSource", () => {
  const series = [
    bar({ time: "2026-01-01T00:00:00.000Z" }),
    bar({ time: "2026-01-02T00:00:00.000Z" }),
    bar({ time: "2026-01-03T00:00:00.000Z" }),
  ];

  it("validates on construction, not on first read", () => {
    expect(() => createInMemoryDataSource("fixture", { TEST: [bar({ high: 1 })] })).toThrow(/malformed/);
  });

  it("returns the whole series when no range is given", async () => {
    const source = createInMemoryDataSource("fixture", { TEST: series });
    expect(await source.bars("TEST")).toHaveLength(3);
  });

  it("filters to an inclusive date range", async () => {
    const source = createInMemoryDataSource("fixture", { TEST: series });
    const bars = await source.bars("TEST", { from: "2026-01-02T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" });
    expect(bars).toHaveLength(2);
  });

  it("is case-insensitive on the symbol and empty for an unknown one", async () => {
    const source = createInMemoryDataSource("fixture", { TEST: series });
    expect(await source.bars("test")).toHaveLength(3);
    expect(await source.bars("NOPE")).toHaveLength(0);
  });

  it("hands out a copy, so a caller cannot mutate the source", async () => {
    const source = createInMemoryDataSource("fixture", { TEST: series });
    (await source.bars("TEST")).pop();
    expect(await source.bars("TEST")).toHaveLength(3);
  });
});

describe("parseCsvBars", () => {
  it("parses a standard header", () => {
    const bars = parseCsvBars(
      ["Date,Open,High,Low,Close,Volume", "2026-01-01,100,105,95,102,1000"].join("\n"),
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(102);
    expect(bars[0].time).toBe("2026-01-01T00:00:00.000Z");
  });

  it("accepts common column aliases and ignores unknown columns", () => {
    const bars = parseCsvBars(
      ["timestamp,o,h,l,c,v,adjusted_close", "2026-01-01,100,105,95,102,1000,101.5"].join("\n"),
    );
    expect(bars[0].open).toBe(100);
    expect(bars[0].volume).toBe(1000);
  });

  it("defaults volume to zero when the column is absent", () => {
    const bars = parseCsvBars(["date,open,high,low,close", "2026-01-01,100,105,95,102"].join("\n"));
    expect(bars[0].volume).toBe(0);
  });

  it("throws when a required column is missing", () => {
    expect(() => parseCsvBars(["date,open,high,low", "2026-01-01,100,105,95"].join("\n"))).toThrow(
      /required column "close"/,
    );
  });

  it("returns an empty array for an empty or header-only file", () => {
    expect(parseCsvBars("")).toEqual([]);
    expect(parseCsvBars("date,open,high,low,close")).toEqual([]);
  });
});
