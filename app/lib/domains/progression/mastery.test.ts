import { describe, expect, it } from "vitest";
import { masteryStateForStreak, applyMasteryEvidence, masteryTransition } from "./mastery";

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

describe("masteryTransition", () => {
  it("starts from NOT_INTRODUCED when no mastery row exists yet", () => {
    // Not INTRODUCED: a null row means never attempted, which is a different
    // thing from an attempted concept sitting on a zero streak.
    expect(masteryTransition(null, 0, true)).toEqual({
      fromState: "NOT_INTRODUCED",
      toState: "LEARNING",
      fromStreak: 0,
      toStreak: 1,
      changed: true,
    });
  });

  it("records a first wrong answer as NOT_INTRODUCED -> INTRODUCED", () => {
    expect(masteryTransition(null, 0, false)).toEqual({
      fromState: "NOT_INTRODUCED",
      toState: "INTRODUCED",
      fromStreak: 0,
      toStreak: 0,
      changed: true,
    });
  });

  it("marks changed=false when the streak grows but the ladder position holds", () => {
    // 3 -> 4 both sit in APPLIED. This is the case that would be lost
    // entirely if the ledger only recorded state changes: real evidence,
    // real streak movement, no transition.
    expect(masteryTransition("APPLIED", 3, true)).toEqual({
      fromState: "APPLIED",
      toState: "APPLIED",
      fromStreak: 3,
      toStreak: 4,
      changed: false,
    });
  });

  it("records the fall back to INTRODUCED when a long streak breaks", () => {
    expect(masteryTransition("MASTERED", 9, false)).toEqual({
      fromState: "MASTERED",
      toState: "INTRODUCED",
      fromStreak: 9,
      toStreak: 0,
      changed: true,
    });
  });

  it("agrees with applyMasteryEvidence on the resulting state and streak", () => {
    for (const streak of [0, 1, 2, 3, 5, 7, 8, 12]) {
      for (const correct of [true, false]) {
        const applied = applyMasteryEvidence(streak, correct);
        const move = masteryTransition("LEARNING", streak, correct);
        expect(move.toState).toBe(applied.state);
        expect(move.toStreak).toBe(applied.consecutiveCorrect);
      }
    }
  });
});
