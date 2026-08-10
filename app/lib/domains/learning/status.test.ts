import { describe, expect, it } from "vitest";
import { allowedNextLessonStatuses, canTransitionLessonStatus } from "./status";

describe("canTransitionLessonStatus", () => {
  it("allows the intended forward path: DRAFT -> REVIEW -> PUBLISHED -> ARCHIVED", () => {
    expect(canTransitionLessonStatus("DRAFT", "REVIEW")).toBe(true);
    expect(canTransitionLessonStatus("REVIEW", "PUBLISHED")).toBe(true);
    expect(canTransitionLessonStatus("PUBLISHED", "ARCHIVED")).toBe(true);
  });

  it("allows rejecting a REVIEW back to DRAFT", () => {
    expect(canTransitionLessonStatus("REVIEW", "DRAFT")).toBe(true);
  });

  it("allows reviving an ARCHIVED lesson back to DRAFT", () => {
    expect(canTransitionLessonStatus("ARCHIVED", "DRAFT")).toBe(true);
  });

  it("rejects skipping straight from DRAFT to PUBLISHED", () => {
    expect(canTransitionLessonStatus("DRAFT", "PUBLISHED")).toBe(false);
  });

  it("rejects skipping straight from DRAFT to ARCHIVED", () => {
    expect(canTransitionLessonStatus("DRAFT", "ARCHIVED")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionLessonStatus("DRAFT", "DRAFT")).toBe(false);
  });

  it("rejects PUBLISHED reverting directly to DRAFT (must archive first)", () => {
    expect(canTransitionLessonStatus("PUBLISHED", "DRAFT")).toBe(false);
  });
});

describe("allowedNextLessonStatuses", () => {
  it("returns the exact allowed set for each status", () => {
    expect(allowedNextLessonStatuses("DRAFT")).toEqual(["REVIEW"]);
    expect(allowedNextLessonStatuses("REVIEW")).toEqual(["DRAFT", "PUBLISHED"]);
    expect(allowedNextLessonStatuses("PUBLISHED")).toEqual(["ARCHIVED"]);
    expect(allowedNextLessonStatuses("ARCHIVED")).toEqual(["DRAFT"]);
  });
});
