// Pure XP arithmetic — no DB access. XpEvent is an append-only ledger
// (DATABASE.md §2.5), so a student's total is always a sum over real events,
// never a value that can drift from its own history.

export const XP_SOURCES = {
  QUIZ_CORRECT: "QUIZ_CORRECT",
} as const;

export type XpSource = (typeof XP_SOURCES)[keyof typeof XP_SOURCES];

export const XP_AMOUNTS: Record<XpSource, number> = {
  QUIZ_CORRECT: 10,
};

export function totalXp(events: { amount: number }[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}
