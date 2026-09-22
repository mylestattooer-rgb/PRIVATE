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

// One piece of evidence, expressed as the movement it caused — what
// gradeAttempt() persists to ConceptMasteryEvent. Kept pure and separate from
// applyMasteryEvidence() so the "what changed" shape is unit-testable without
// a database, matching this folder's existing split between derivation and
// the DB writes that consume it.
export type MasteryTransition = {
  fromState: MasteryStateValue;
  toState: MasteryStateValue;
  fromStreak: number;
  toStreak: number;
  // True only when the ladder position moved. Streak movement alone (a
  // correct answer at an unchanged state) is still recorded — this flag just
  // makes "show me the transitions" a filter rather than a comparison.
  changed: boolean;
};

export function masteryTransition(
  // null means no ConceptMastery row exists yet — the concept has never been
  // attempted, so the student starts from NOT_INTRODUCED rather than from the
  // INTRODUCED that a zero streak would otherwise imply.
  currentState: MasteryStateValue | null,
  currentConsecutiveCorrect: number,
  thisAttemptCorrect: boolean
): MasteryTransition {
  const fromState = currentState ?? "NOT_INTRODUCED";
  const { consecutiveCorrect, state } = applyMasteryEvidence(currentConsecutiveCorrect, thisAttemptCorrect);
  return {
    fromState,
    toState: state,
    fromStreak: currentConsecutiveCorrect,
    toStreak: consecutiveCorrect,
    changed: fromState !== state,
  };
}
