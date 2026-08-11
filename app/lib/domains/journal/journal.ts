// No "server-only" import (unlike app/lib/auth.ts): this module is also
// imported by prisma/seed.ts, which runs under tsx/node outside Next's
// bundler — matches the app/lib/ai/retrieval.ts / app/lib/domains/learning
// precedent.
import { prisma } from "@/app/lib/db";
import { computeJournalStats } from "./stats";
import { generateInsightText } from "./insights";

export async function createTrade(input: {
  studentId: string;
  symbol: string;
  direction: string;
  entryPrice?: number;
  exitPrice?: number;
  result?: string;
  rMultiple?: number;
  setupTag?: string;
  mistakeTag?: string;
  notes?: string;
  tradedAt: Date;
}) {
  return prisma.journalTrade.create({ data: input });
}

export async function deleteTrade(studentId: string, tradeId: string) {
  // Scoped by studentId, not just tradeId — a student can only delete their
  // own trades (SECURITY.md's student data isolation requirement), enforced
  // at the query layer rather than trusted from the caller.
  return prisma.journalTrade.deleteMany({ where: { id: tradeId, studentId } });
}

// Generates a new AiInsight from the student's own journal, or returns null
// (with a reason) if there isn't enough data yet. Every insight links back
// to the exact trades it was computed from (brief §15's evidence
// requirement) — never a floating claim with nothing to point at.
export async function generateInsight(studentId: string) {
  const trades = await prisma.journalTrade.findMany({ where: { studentId } });
  const stats = computeJournalStats(trades);
  const summary = generateInsightText(stats);
  if (!summary) return null;

  return prisma.aiInsight.create({
    data: {
      studentId,
      summary,
      provider: "deterministic", // see insights.ts header — not yet wired to app/lib/ai/provider.ts
      trades: { connect: trades.map((t) => ({ id: t.id })) },
    },
  });
}
