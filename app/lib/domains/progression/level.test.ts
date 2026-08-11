import { describe, expect, it } from "vitest";
import { levelForXp, xpToNextLevel } from "./level";

const LEVELS = [
  { id: "l0", name: "Market Orientation", xpThreshold: 0 },
  { id: "l1", name: "Foundations", xpThreshold: 50 },
  { id: "l2", name: "Chart Reading", xpThreshold: 150 },
];

describe("levelForXp", () => {
  it("returns the highest level whose threshold is <= xp", () => {
    expect(levelForXp(0, LEVELS)?.id).toBe("l0");
    expect(levelForXp(49, LEVELS)?.id).toBe("l0");
    expect(levelForXp(50, LEVELS)?.id).toBe("l1");
    expect(levelForXp(200, LEVELS)?.id).toBe("l2");
  });

  it("returns null when no level's threshold is met (empty levels)", () => {
    expect(levelForXp(100, [])).toBeNull();
  });

  it("is unaffected by input ordering", () => {
    const shuffled = [LEVELS[2], LEVELS[0], LEVELS[1]];
    expect(levelForXp(75, shuffled)?.id).toBe("l1");
  });
});

describe("xpToNextLevel", () => {
  it("returns the next level and remaining XP needed", () => {
    expect(xpToNextLevel(10, LEVELS)).toEqual({ next: LEVELS[1], remaining: 40 });
  });

  it("returns null when already at the top level", () => {
    expect(xpToNextLevel(500, LEVELS)).toBeNull();
  });
});
