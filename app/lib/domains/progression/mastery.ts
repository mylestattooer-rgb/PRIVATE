// Pure concept-mastery state derivation — no DB access. State is a function
// of (has this concept ever been attempted, current consecutive-correct
// streak), not stored/mutated ad hoc — see CURRICULUM_SYSTEM.md's
// NOT_INTRODUCED -> ... -> MASTERED ladder (brief §7).
//
// A wrong answer resets the streak to 0 (drops to INTRODUCED) but the state
// only ever reflects the CURRENT streak — it does not track a separate
// "best ever reached" high-water mark. This is deliberately simple: the
// brief's "confidence decays when evidence is old" is a distinct,
// time-based mechanism (via lastEvidenceAt) that isn't built yet, and
// conflating "decays because it's stale" with "resets because you just got
// one wrong" would be designing two mechanisms as if they were one.
export const MASTERY_STATES = [
  "NOT_INTRODUCED",
  "INTRODUCED",
  "LEARNING",
  "UNDERSTOOD",
  "APPLIED",
  "CONSISTENT",
  "MASTERED",
] as const;

export type MasteryStateValue = (typeof MASTERY_STATES)[number];

// consecutiveCorrect -> state, once the concept has been attempted at least once.
const STREAK_THRESHOLDS: [minStreak: number, state: MasteryStateValue][] = [
  [8, "MASTERED"],
  [5, "CONSISTENT"],
  [3, "APPLIED"],
  [2, "UNDERSTOOD"],
  [1, "LEARNING"],
  [0, "INTRODUCED"],
];

export function masteryStateForStreak(everAttempted: boolean, consecutiveCorrect: number): MasteryStateValue {
  if (!everAttempted) return "NOT_INTRODUCED";
  const [, state] = STREAK_THRESHOLDS.find(([min]) => consecutiveCorrect >= min)!;
  return state;
}

// Applies one new piece of evidence (a graded QuestionAttempt) to a concept's
// current streak and returns the next (streak, state) pair.
export function applyMasteryEvidence(
  currentConsecutiveCorrect: number,
  thisAttemptCorrect: boolean
): { consecutiveCorrect: number; state: MasteryStateValue } {
  const consecutiveCorrect = thisAttemptCorrect ? currentConsecutiveCorrect + 1 : 0;
  return { consecutiveCorrect, state: masteryStateForStreak(true, consecutiveCorrect) };
}
