// Pure insight-text generation from already-computed stats — no DB access,
// no AI call. This is deliberately NOT wired to app/lib/ai/provider.ts yet:
// every number here is a plain aggregation (see stats.ts), and phrasing it
// with an LLM would add a dependency (and a mock-mode "no API key" caveat)
// for zero behavioral benefit until there's a reason to want more natural
// phrasing than a template gives. Swapping the AiProvider in later is a
// non-breaking change to generateInsightText's caller, not this function.
//
// "Do not manufacture behavioural conclusions from insufficient data" (brief
// §15) is enforced by MIN_TRADES_FOR_INSIGHT — below that, every function
// here returns null rather than a low-confidence guess dressed as a finding.

import type { JournalStats } from "./stats";

export const MIN_TRADES_FOR_INSIGHT = 5;

export function generateInsightText(stats: JournalStats): string | null {
  if (stats.totalTrades < MIN_TRADES_FOR_INSIGHT) return null;

  const lines: string[] = [];

  if (stats.winRatePct != null) {
    lines.push(`Win rate: ${stats.winRatePct.toFixed(0)}% across ${stats.wins + stats.losses} decided trades.`);
  }
  if (stats.avgRMultiple != null) {
    lines.push(`Average R multiple: ${stats.avgRMultiple.toFixed(2)}R across ${stats.totalTrades} trades.`);
  }
  if (stats.bestSetupTag && stats.worstSetupTag && stats.bestSetupTag.tag !== stats.worstSetupTag.tag) {
    lines.push(
      `Your best-performing setup is "${stats.bestSetupTag.tag}" (avg ${stats.bestSetupTag.avgR.toFixed(2)}R), ` +
        `your weakest is "${stats.worstSetupTag.tag}" (avg ${stats.worstSetupTag.avgR.toFixed(2)}R).`
    );
  } else if (stats.bestSetupTag) {
    lines.push(`Your only tagged setup so far is "${stats.bestSetupTag.tag}" (avg ${stats.bestSetupTag.avgR.toFixed(2)}R).`);
  }
  if (stats.mostCommonMistakeTag && stats.mostCommonMistakeTag.count >= 2) {
    lines.push(
      `Your most frequently logged mistake is "${stats.mostCommonMistakeTag.tag}" (${stats.mostCommonMistakeTag.count} trades).`
    );
  }

  return lines.length > 0 ? lines.join(" ") : null;
}
