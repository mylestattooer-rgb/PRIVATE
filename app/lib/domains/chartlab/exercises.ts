// No "server-only" import (unlike app/lib/auth.ts): this module is also
// callable from prisma/seed.ts, which runs outside Next's bundler — matches
// the app/lib/ai/retrieval.ts / app/lib/domains/learning precedent.
import { prisma } from "@/app/lib/db";
import { socraticFollowUp } from "@/app/lib/ai/provider";

export async function createChartExercise(input: {
  title: string;
  prompt: string;
  imageDataUrl: string;
  conceptIds?: string[];
}) {
  return prisma.chartExercise.create({
    data: {
      title: input.title,
      prompt: input.prompt,
      imageDataUrl: input.imageDataUrl,
      concepts: input.conceptIds ? { connect: input.conceptIds.map((id) => ({ id })) } : undefined,
    },
  });
}

// Records the student's "what do you see?" response and asks one Socratic
// follow-up — never grades, never hands over an answer (AI_ARCHITECTURE.md
// "Planned: Socratic Chart Lab tutor"). priorAnswerCount (this student's
// past attempts on this exercise) drives which question comes back in mock
// mode, so a repeat attempt doesn't feel identical.
export async function submitChartAnswer(input: { studentId: string; chartExerciseId: string; response: string }) {
  // findFirst, not findUniqueOrThrow: a bad/stale chartExerciseId is
  // student-suppliable form input, not an invariant — same bug shape (and
  // same fix) as app/api/student/chat/route.ts's conversationId lookup, see
  // its comment. Returns null so the calling Server Action's existing
  // silent-no-op convention for invalid input covers this too, rather than
  // an unhandled 500.
  const exercise = await prisma.chartExercise.findFirst({ where: { id: input.chartExerciseId } });
  if (!exercise) return null;

  const priorAnswerCount = await prisma.chartAnswer.count({
    where: { studentId: input.studentId, chartExerciseId: input.chartExerciseId },
  });

  const followUp = await socraticFollowUp({
    exercisePrompt: exercise.prompt,
    studentResponse: input.response,
    priorAnswerCount,
  });

  return prisma.chartAnswer.create({
    data: {
      studentId: input.studentId,
      chartExerciseId: input.chartExerciseId,
      response: input.response,
      followUpQuestion: followUp.text,
    },
  });
}

// A student can only record their own reply to the follow-up — studentId is
// a mandatory filter on the update, not trusted from the caller.
export async function submitFollowUpResponse(input: { studentId: string; chartAnswerId: string; response: string }) {
  return prisma.chartAnswer.updateMany({
    where: { id: input.chartAnswerId, studentId: input.studentId },
    data: { followUpResponse: input.response },
  });
}
