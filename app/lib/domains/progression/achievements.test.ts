import { describe, expect, it } from "vitest";
import { shouldUnlockFirstQuizPassed } from "./achievements";

describe("shouldUnlockFirstQuizPassed", () => {
  it("unlocks on a correct attempt with zero prior correct attempts", () => {
    expect(shouldUnlockFirstQuizPassed(0, true)).toBe(true);
  });

  it("does not unlock on an incorrect attempt", () => {
    expect(shouldUnlockFirstQuizPassed(0, false)).toBe(false);
  });

  it("does not unlock again once the student already has a correct attempt", () => {
    expect(shouldUnlockFirstQuizPassed(1, true)).toBe(false);
    expect(shouldUnlockFirstQuizPassed(5, true)).toBe(false);
  });

  it("does not unlock on an incorrect attempt even with prior correct attempts", () => {
    expect(shouldUnlockFirstQuizPassed(3, false)).toBe(false);
  });
});
