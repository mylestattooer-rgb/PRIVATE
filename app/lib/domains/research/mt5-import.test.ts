import { describe, expect, it } from "vitest";
import { parseMt5Export, spreadPointsToBps } from "./mt5-import";

const TAB = "\t";

const withTime = [
  ["<DATE>", "<TIME>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>", "<TICKVOL>", "<VOL>", "<SPREAD>"].join(TAB),
  ["2024.01.02", "00:00:00", "2063.10", "2065.50", "2061.20", "2064.30", "1234", "0", "25"].join(TAB),
  ["2024.01.03", "00:00:00", "2064.30", "2070.00", "2060.00", "2068.90", "2200", "0", "30"].join(TAB),
  ["2024.01.04", "00:00:00", "2068.90", "2072.00", "2055.00", "2058.10", "1900", "0", "120"].join(TAB),
].join("\n");

describe("parseMt5Export", () => {
  it("parses MT5's angle-bracket tab format", () => {
    const { bars, columns } = parseMt5Export(withTime);
    expect(bars).toHaveLength(3);
    expect(columns).toContain("spread");
    expect(bars[0]).toMatchObject({ open: 2063.1, high: 2065.5, low: 2061.2, close: 2064.3, volume: 1234 });
  });

  it("produces ISO timestamps", () => {
    expect(parseMt5Export(withTime).bars[0].time).toBe("2024-01-02T00:00:00.000Z");
  });

  it("shifts server time to UTC when told the offset", () => {
    // A GMT+2 broker's midnight bar is 22:00 UTC the previous day. Getting this
    // wrong shifts every bar a day against other data.
    const { bars } = parseMt5Export(withTime, { serverOffsetHours: 2 });
    expect(bars[0].time).toBe("2024-01-01T22:00:00.000Z");
  });

  it("handles a daily export with no TIME column", () => {
    const noTime = [
      ["<DATE>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>", "<TICKVOL>"].join(TAB),
      ["2024.01.02", "1.1050", "1.1080", "1.1030", "1.1070", "500"].join(TAB),
    ].join("\n");
    const { bars } = parseMt5Export(noTime);
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe("2024-01-02T00:00:00.000Z");
    expect(bars[0].spreadPoints).toBeNull();
  });

  it("handles comma-separated exports from older builds", () => {
    const csv = ["<DATE>,<OPEN>,<HIGH>,<LOW>,<CLOSE>", "2024.01.02,1.1050,1.1080,1.1030,1.1070"].join("\n");
    expect(parseMt5Export(csv).bars).toHaveLength(1);
  });

  it("matches columns by name, not position", () => {
    const reordered = [
      ["<CLOSE>", "<DATE>", "<HIGH>", "<LOW>", "<OPEN>"].join(TAB),
      ["1.1070", "2024.01.02", "1.1080", "1.1030", "1.1050"].join(TAB),
    ].join("\n");
    const { bars } = parseMt5Export(reordered);
    expect(bars[0]).toMatchObject({ open: 1.105, close: 1.107 });
  });

  it("sorts bars chronologically regardless of file order", () => {
    const reversed = [
      ["<DATE>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"].join(TAB),
      ["2024.01.03", "2", "3", "1", "2"].join(TAB),
      ["2024.01.02", "1", "2", "1", "1"].join(TAB),
    ].join("\n");
    const { bars } = parseMt5Export(reversed);
    expect(bars[0].time < bars[1].time).toBe(true);
  });

  it("rejects malformed rows loudly instead of shortening the series silently", () => {
    const broken = [
      ["<DATE>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"].join(TAB),
      ["2024.01.02", "1.10", "1.05", "1.08", "1.09"].join(TAB), // high below open
      ["not-a-date", "1.10", "1.20", "1.00", "1.15"].join(TAB),
      ["2024.01.04", "1.10", "1.20", "1.00", "1.15"].join(TAB),
    ].join("\n");
    const { bars, rejected } = parseMt5Export(broken);

    expect(bars).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toContain("inconsistent OHLC");
    expect(rejected[1].reason).toContain("unparseable");
  });

  it("throws when a required column is absent", () => {
    const missing = ["<DATE>\t<OPEN>\t<HIGH>", "2024.01.02\t1\t2"].join("\n");
    expect(() => parseMt5Export(missing)).toThrow(/missing a required column/);
  });

  it("returns nothing for an empty or header-only file", () => {
    expect(parseMt5Export("").bars).toEqual([]);
    expect(parseMt5Export("<DATE>\t<OPEN>").bars).toEqual([]);
  });
});

describe("spread measurement", () => {
  it("summarises the spread column, leading with the median", () => {
    const { spread } = parseMt5Export(withTime);
    expect(spread).not.toBeNull();
    expect(spread!.samples).toBe(3);
    // 25, 30, 120 — the mean is dragged by the tail, the median is not.
    expect(spread!.medianPoints).toBe(30);
    expect(spread!.maxPoints).toBe(120);
    expect(spread!.meanPoints).toBeGreaterThan(spread!.medianPoints);
  });

  it("does not record a blank spread cell as a measured zero", () => {
    // Number("") is 0 — the most flattering possible fabrication.
    const blanks = [
      ["<DATE>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>", "<SPREAD>"].join(TAB),
      ["2024.01.02", "1.10", "1.20", "1.00", "1.15", ""].join(TAB),
      ["2024.01.03", "1.15", "1.25", "1.05", "1.20", "18"].join(TAB),
    ].join("\n");
    const { bars, spread } = parseMt5Export(blanks);

    expect(bars[0].spreadPoints).toBeNull();
    expect(spread!.samples).toBe(1);
    expect(spread!.medianPoints).toBe(18);
  });

  it("reports no spread summary when the export has no spread column", () => {
    const noSpread = ["<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>", "2024.01.02\t1\t2\t1\t1.5"].join("\n");
    expect(parseMt5Export(noSpread).spread).toBeNull();
  });
});

describe("spreadPointsToBps", () => {
  it("converts a 5-digit FX spread", () => {
    // 12 points at 0.00001 on a 1.10 price = 0.00012 / 1.10 = ~1.09bps.
    expect(spreadPointsToBps(12, 0.00001, 1.1)).toBeCloseTo(1.0909, 3);
  });

  it("converts a gold spread quoted in cents", () => {
    // 25 points at 0.01 on 2064 = 0.25 / 2064 = ~1.21bps.
    expect(spreadPointsToBps(25, 0.01, 2064)).toBeCloseTo(1.2112, 3);
  });

  it("is zero for a nonsensical price or point size", () => {
    expect(spreadPointsToBps(10, 0.01, 0)).toBe(0);
    expect(spreadPointsToBps(10, 0, 100)).toBe(0);
  });
});
