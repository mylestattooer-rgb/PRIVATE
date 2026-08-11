import { describe, expect, it } from "vitest";
import { totalXp, XP_AMOUNTS } from "./xp";

describe("totalXp", () => {
  it("sums event amounts", () => {
    expect(totalXp([{ amount: 10 }, { amount: 10 }, { amount: 5 }])).toBe(25);
  });

  it("returns 0 for no events", () => {
    expect(totalXp([])).toBe(0);
  });

  it("handles a single event", () => {
    expect(totalXp([{ amount: XP_AMOUNTS.QUIZ_CORRECT }])).toBe(10);
  });
});
