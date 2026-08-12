// Pure Socratic-question selection — no DB, no AI call. Used by the mock
// provider path (AI_ARCHITECTURE.md's "Planned: Socratic Chart Lab tutor"):
// the AI's job here is to ask, not answer, so even without a real model call
// the mock behavior stays honest — it picks a real, relevant question from a
// fixed bank rather than fabricating "reasoning" it isn't doing. Real
// phrasing (when ANTHROPIC_API_KEY is set) comes from app/lib/ai/provider.ts.

export const SOCRATIC_QUESTIONS = [
  "What makes you consider that a liquidity sweep, specifically?",
  "Where would this idea become invalid — what would have to happen for you to be wrong?",
  "What's the higher-timeframe context here? Does it agree with what you're describing?",
  "Whose liquidity might have just been taken — where were the obvious stops resting?",
  "What evidence supports your directional bias, beyond what you've already said?",
  "What evidence contradicts your bias? Is there anything you're not accounting for?",
  "If price moved to the opposite extreme of this range first, would your thesis still hold?",
] as const;

// Deterministic, not random — picks based on how many prior exchanges exist
// on this exercise, so a given student sees a genuinely different question
// on a second attempt rather than the same one by chance, without needing
// Math.random() (kept out of application logic here so this stays testable).
export function pickSocraticQuestion(priorAnswerCount: number): string {
  return SOCRATIC_QUESTIONS[priorAnswerCount % SOCRATIC_QUESTIONS.length];
}
