// Pure lesson status state machine — no DB access, so it's cheap to unit test
// and the one place transition rules live (CURRICULUM_SYSTEM.md "Versioning").
export const LESSON_STATUSES = ["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type LessonStatusValue = (typeof LESSON_STATUSES)[number];

const TRANSITIONS: Record<LessonStatusValue, LessonStatusValue[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["DRAFT", "PUBLISHED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function canTransitionLessonStatus(from: LessonStatusValue, to: LessonStatusValue): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextLessonStatuses(from: LessonStatusValue): LessonStatusValue[] {
  return TRANSITIONS[from] ?? [];
}
