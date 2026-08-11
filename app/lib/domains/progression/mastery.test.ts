import { describe, expect, it } from "vitest";
import { masteryStateForStreak, applyMasteryEvidence } from "./mastery";

describe("masteryStateForStreak", () => {
  it("returns NOT_INTRODUCED when never attempted, regardless of streak value", () => {
    expect(masteryStateForStreak(false, 0)).toBe("NOT_INTRODUCED");
    expect(masteryStateForStreak(false, 10)).toBe("NOT_INTRODUCED");
  });

  it("maps streak thresholds correctly once attempted", () => {
    expect(masteryStateForStreak(true, 0)).toBe("INTRODUCED");
    expect(masteryStateForStreak(true, 1)).toBe("LEARNING");
    expect(masteryStateForStreak(true, 2)).toBe("UNDERSTOOD");
    expect(masteryStateForStreak(true, 3)).toBe("APPLIED");
    expect(masteryStateForStreak(true, 4)).toBe("APPLIED");
    expect(masteryStateForStreak(true, 5)).toBe("CONSISTENT");
    expect(masteryStateForStreak(true, 7)).toBe("CONSISTENT");
    expect(masteryStateForStreak(true, 8)).toBe("MASTERED");
    expect(masteryStateForStreak(true, 100)).toBe("MASTERED");
  });
});

describe("applyMasteryEvidence", () => {
  it("increments the streak and advances state on a correct answer", () => {
    expect(applyMasteryEvidence(0, true)).toEqual({ consecutiveCorrect: 1, state: "LEARNING" });
    expect(applyMasteryEvidence(1, true)).toEqual({ consecutiveCorrect: 2, state: "UNDERSTOOD" });
    expect(applyMasteryEvidence(7, true)).toEqual({ consecutiveCorrect: 8, state: "MASTERED" });
  });

  it("resets the streak to 0 (state INTRODUCED) on an incorrect answer", () => {
    expect(applyMasteryEvidence(5, false)).toEqual({ consecutiveCorrect: 0, state: "INTRODUCED" });
    expect(applyMasteryEvidence(0, false)).toEqual({ consecutiveCorrect: 0, state: "INTRODUCED" });
  });
});
