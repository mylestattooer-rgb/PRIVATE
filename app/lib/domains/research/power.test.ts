import { describe, expect, it } from "vitest";
import { detectableEdge, independentSamples, requiredSamples } from "./power";

describe("requiredSamples", () => {
  it("matches the textbook figure for a coin-flip baseline", () => {
    // Detecting 55% against 50%, one-sided, alpha .05, power .8 — a standard
    // worked example that lands just over 600.
    const n = requiredSamples({ baseline: 0.5, target: 0.55 });
    expect(n).toBeGreaterThan(580);
    expect(n).toBeLessThan(640);
  });

  it("scales roughly with the inverse square of the edge", () => {
    const wide = requiredSamples({ baseline: 0.5, target: 0.55 }); // 5 points
    const narrow = requiredSamples({ baseline: 0.5, target: 0.525 }); // 2.5 points
    expect(narrow / wide).toBeGreaterThan(3.6);
    expect(narrow / wide).toBeLessThan(4.4);
  });

  it("is infinite when the target does not beat the baseline", () => {
    expect(requiredSamples({ baseline: 0.52, target: 0.52 })).toBe(Number.POSITIVE_INFINITY);
    expect(requiredSamples({ baseline: 0.52, target: 0.5 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("demands more sample for a stricter alpha or higher power", () => {
    const base = requiredSamples({ baseline: 0.5, target: 0.55 });
    expect(requiredSamples({ baseline: 0.5, target: 0.55, alpha: 0.01 })).toBeGreaterThan(base);
    expect(requiredSamples({ baseline: 0.5, target: 0.55, power: 0.95 })).toBeGreaterThan(base);
  });

  it("costs more sample as the baseline rises above a coin flip", () => {
    // A break-even rate of 52% is a harder thing to beat by 2 points than 50%
    // is, because the null itself has moved.
    const atHalf = requiredSamples({ baseline: 0.5, target: 0.52 });
    const atFiftyTwo = requiredSamples({ baseline: 0.52, target: 0.54 });
    expect(atFiftyTwo).toBeGreaterThan(atHalf * 0.9);
  });
});

describe("detectableEdge", () => {
  it("inverts requiredSamples", () => {
    const n = requiredSamples({ baseline: 0.5, target: 0.55 });
    const edge = detectableEdge(n, 0.5);
    expect(edge).toBeGreaterThan(0.049);
    expect(edge).toBeLessThan(0.051);
  });

  it("shrinks as sample grows", () => {
    expect(detectableEdge(10_000, 0.5)).toBeLessThan(detectableEdge(1_000, 0.5));
    expect(detectableEdge(1_000, 0.5)).toBeLessThan(detectableEdge(100, 0.5));
  });

  it("is infinite with no observations", () => {
    expect(detectableEdge(0, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("reports an impossible requirement when break-even is already certainty", () => {
    expect(detectableEdge(10_000, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("independentSamples", () => {
  it("divides by the horizon rather than counting every bar", () => {
    // The whole point: 900 minute bars hold 60 independent 15-minute
    // observations, not 900. Using 900 would claim fifteen times the
    // information actually present.
    expect(independentSamples(900, 15)).toBe(60);
    expect(independentSamples(900, 1)).toBe(900);
  });

  it("floors rather than rounding up a partial window", () => {
    expect(independentSamples(29, 15)).toBe(1);
    expect(independentSamples(14, 15)).toBe(0);
  });

  it("handles degenerate input", () => {
    expect(independentSamples(0, 15)).toBe(0);
    expect(independentSamples(100, 0)).toBe(0);
  });
});
