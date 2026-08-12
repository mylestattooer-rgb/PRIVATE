import { describe, expect, it } from "vitest";
import { pickSocraticQuestion, SOCRATIC_QUESTIONS } from "./socratic";

describe("pickSocraticQuestion", () => {
  it("returns a real question from the bank for the first attempt", () => {
    expect(SOCRATIC_QUESTIONS).toContain(pickSocraticQuestion(0));
  });

  it("cycles to a different question on a subsequent attempt", () => {
    expect(pickSocraticQuestion(0)).not.toBe(pickSocraticQuestion(1));
  });

  it("wraps around once every question in the bank has been used", () => {
    expect(pickSocraticQuestion(0)).toBe(pickSocraticQuestion(SOCRATIC_QUESTIONS.length));
  });

  it("is deterministic — same input always returns the same question", () => {
    expect(pickSocraticQuestion(3)).toBe(pickSocraticQuestion(3));
  });
});
