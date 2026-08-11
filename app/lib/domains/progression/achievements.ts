// Pure achievement-unlock rules — no DB access. Each checker takes only the
// facts it needs (never the whole student record) and returns a boolean, so
// the DB-touching caller (app/lib/domains/assessment/questions.ts) stays a
// thin "gather facts, call checker, write result if true" shell. Achievements
// are validated server-side only (brief §18) — nothing here can be satisfied
// by a client-reported flag.

export const ACHIEVEMENT_KEYS = {
  FIRST_QUIZ_PASSED: "FIRST_QUIZ_PASSED",
} as const;

export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[keyof typeof ACHIEVEMENT_KEYS];

// priorCorrectAttempts: how many QuestionAttempt rows with correct=true this
// student had BEFORE the attempt just graded.
export function shouldUnlockFirstQuizPassed(priorCorrectAttempts: number, thisAttemptCorrect: boolean): boolean {
  return thisAttemptCorrect && priorCorrectAttempts === 0;
}
