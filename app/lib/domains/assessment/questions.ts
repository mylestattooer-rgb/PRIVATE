// No "server-only" import (unlike app/lib/auth.ts): this module is also
// imported by prisma/seed.ts, which runs under tsx/node outside Next's
// bundler — matches the app/lib/ai/retrieval.ts / app/lib/domains/learning
// precedent.
import { prisma } from "@/app/lib/db";
import { XP_AMOUNTS, XP_SOURCES } from "@/app/lib/domains/progression/xp";
import { ACHIEVEMENT_KEYS, shouldUnlockFirstQuizPassed } from "@/app/lib/domains/progression/achievements";
import { applyMasteryEvidence } from "@/app/lib/domains/progression/mastery";

export async function createQuestion(input: {
  lessonId: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
  conceptIds?: string[];
}) {
  if (input.correctIndex < 0 || input.correctIndex >= input.choices.length) {
    throw new Error("correctIndex must be a valid index into choices");
  }
  return prisma.question.create({
    data: {
      lessonId: input.lessonId,
      prompt: input.prompt,
      choices: JSON.stringify(input.choices),
      correctIndex: input.correctIndex,
      explanation: input.explanation,
      concepts: input.conceptIds ? { connect: input.conceptIds.map((id) => ({ id })) } : undefined,
    },
  });
}

// The one place a quiz answer is graded — deterministic (index equality),
// never delegated to AI judgment (AI_ARCHITECTURE.md's determinism boundary).
// Records the attempt, awards XP on a correct answer, and checks for a
// server-side achievement unlock — all in one transaction so a crash
// mid-grade can't award XP without recording the attempt, or vice versa.
export async function gradeAttempt(input: { studentId: string; questionId: string; selectedIndex: number }) {
  const question = await prisma.question.findUniqueOrThrow({
    where: { id: input.questionId },
    include: { concepts: true },
  });
  const correct = input.selectedIndex === question.correctIndex;

  const priorCorrectAttempts = await prisma.questionAttempt.count({
    where: { studentId: input.studentId, correct: true },
  });

  return prisma.$transaction(async (tx) => {
    const attempt = await tx.questionAttempt.create({
      data: {
        studentId: input.studentId,
        questionId: input.questionId,
        selectedIndex: input.selectedIndex,
        correct,
      },
    });

    let xpAwarded = 0;
    if (correct) {
      xpAwarded = XP_AMOUNTS.QUIZ_CORRECT;
      await tx.xpEvent.create({
        data: { studentId: input.studentId, source: XP_SOURCES.QUIZ_CORRECT, amount: xpAwarded },
      });
    }

    // Every concept this question tests gets one piece of mastery evidence,
    // regardless of correctness — a wrong answer still means the concept was
    // attempted (CURRICULUM_SYSTEM.md's NOT_INTRODUCED -> ... -> MASTERED
    // ladder), it just resets the consecutive-correct streak.
    for (const concept of question.concepts) {
      const existing = await tx.conceptMastery.findUnique({
        where: { studentId_conceptId: { studentId: input.studentId, conceptId: concept.id } },
      });
      const { consecutiveCorrect, state } = applyMasteryEvidence(existing?.consecutiveCorrect ?? 0, correct);
      await tx.conceptMastery.upsert({
        where: { studentId_conceptId: { studentId: input.studentId, conceptId: concept.id } },
        update: { consecutiveCorrect, state, lastEvidenceAt: new Date() },
        create: { studentId: input.studentId, conceptId: concept.id, consecutiveCorrect, state, lastEvidenceAt: new Date() },
      });
    }

    let achievementUnlocked = null;
    if (shouldUnlockFirstQuizPassed(priorCorrectAttempts, correct)) {
      const achievement = await tx.achievement.findUnique({
        where: { key: ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED },
      });
      if (achievement) {
        await tx.userAchievement.upsert({
          where: { studentId_achievementId: { studentId: input.studentId, achievementId: achievement.id } },
          update: {},
          create: { studentId: input.studentId, achievementId: achievement.id },
        });
        achievementUnlocked = achievement;
      }
    }

    return { attempt, correct, correctIndex: question.correctIndex, explanation: question.explanation, xpAwarded, achievementUnlocked };
  });
}
