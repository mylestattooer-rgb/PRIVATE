import { describe, expect, it } from "vitest";
import { calibrate, CANONICAL_TSMOM_SPEC, momentumSignal, volScaledWeight, warmupBars } from "./tsmom";

describe("momentumSignal", () => {
  it("is +1 for a positive trailing return and -1 for a negative one", () => {
    expect(momentumSignal(0.2)).toBe(1);
    expect(momentumSignal(-0.2)).toBe(-1);
  });

  it("treats exactly flat as long rather than inventing a third state", () => {
    expect(momentumSignal(0)).toBe(1);
  });

  it("is null when there is no trailing return", () => {
    expect(momentumSignal(null)).toBeNull();
    expect(momentumSignal(Number.NaN)).toBeNull();
  });
});

describe("volScaledWeight", () => {
  const config = calibrate(CANONICAL_TSMOM_SPEC, 252);

  it("sizes inversely to volatility", () => {
    const calm = volScaledWeight(1, 0.05, config).weight;
    const wild = volScaledWeight(1, 0.4, config).weight;
    expect(calm).toBeGreaterThan(wild);
    // 10% target over 20% vol is a half-sized position.
    expect(volScaledWeight(1, 0.2, config).weight).toBeCloseTo(0.5, 10);
  });

  it("signs the weight by direction", () => {
    expect(volScaledWeight(-1, 0.2, config).weight).toBeCloseTo(-0.5, 10);
  });

  it("caps leverage and reports that it bound", () => {
    const { weight, capped } = volScaledWeight(1, 0.001, config);
    expect(weight).toBe(config.maxWeightPerInstrument);
    expect(capped).toBe(true);
  });

  it("allocates nothing when risk cannot be measured", () => {
    expect(volScaledWeight(1, null, config).weight).toBe(0);
    expect(volScaledWeight(1, 0, config).weight).toBe(0);
    expect(volScaledWeight(null, 0.2, config).weight).toBe(0);
  });
});

describe("calibrate", () => {
  it("derives bar counts from the calendar, so 12 months means 12 months", () => {
    // The bug this exists to prevent: assuming 252 on a 336-bar/year calendar
    // turns a 12-month lookback into a 9-month one.
    const onTradingDays = calibrate(CANONICAL_TSMOM_SPEC, 252);
    const onUnionCalendar = calibrate(CANONICAL_TSMOM_SPEC, 336.3);

    expect(onTradingDays.lookback).toBe(252);
    expect(onUnionCalendar.lookback).toBe(336);
    expect(onUnionCalendar.periodsPerYear).toBeCloseTo(336.3, 5);
  });

  it("scales every window together", () => {
    const c = calibrate(CANONICAL_TSMOM_SPEC, 336);
    expect(c.volWindow).toBe(84); // 3 months
    expect(c.rebalanceEvery).toBe(28); // 1 month
  });

  it("never produces a degenerate window", () => {
    const c = calibrate({ ...CANONICAL_TSMOM_SPEC, lookbackMonths: 0, volWindowMonths: 0 }, 12);
    expect(c.lookback).toBeGreaterThanOrEqual(2);
    expect(c.volWindow).toBeGreaterThanOrEqual(2);
    expect(c.rebalanceEvery).toBeGreaterThanOrEqual(1);
  });
});

describe("warmupBars", () => {
  it("is the longest window the strategy needs", () => {
    const c = calibrate(CANONICAL_TSMOM_SPEC, 336);
    expect(warmupBars(c)).toBe(c.lookback);
  });
});
