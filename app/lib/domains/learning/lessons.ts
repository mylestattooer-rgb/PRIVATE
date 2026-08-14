// No "server-only" import here (unlike app/lib/auth.ts): this module is also
// imported by prisma/seed.ts, which runs under tsx/node outside Next's
// bundler, where "server-only" isn't a real resolvable package — it's a
// Next-provided virtual module. Matches the existing app/lib/ai/retrieval.ts
// precedent, which has the same dual Server-Action + seed-script usage.
import { prisma } from "@/app/lib/db";
import { canTransitionLessonStatus, type LessonStatusValue } from "./status";

export async function createLesson(input: {
  moduleId: string;
  title: string;
  slug: string;
  content: string;
  learningObjectives?: string;
  assessmentCriteria?: string;
  authorId?: string;
}) {
  return prisma.lesson.create({
    data: {
      moduleId: input.moduleId,
      title: input.title,
      slug: input.slug,
      versions: {
        create: {
          version: 1,
          content: input.content,
          learningObjectives: input.learningObjectives,
          assessmentCriteria: input.assessmentCriteria,
          authorId: input.authorId,
        },
      },
    },
    include: { versions: true },
  });
}

// Editing always creates a new version rather than mutating the latest one,
// and resets status to DRAFT — an edited PUBLISHED lesson needs re-review
// before the change reaches students, per CURRICULUM_SYSTEM.md. Students
// already engaged with the lesson keep seeing the old currentVersionId
// until this is published again.
export async function addLessonVersion(input: {
  lessonId: string;
  content: string;
  learningObjectives?: string;
  assessmentCriteria?: string;
  authorId?: string;
}) {
  const latest = await prisma.lessonVersion.findFirst({
    where: { lessonId: input.lessonId },
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const [version] = await prisma.$transaction([
    prisma.lessonVersion.create({
      data: {
        lessonId: input.lessonId,
        version: nextVersion,
        content: input.content,
        learningObjectives: input.learningObjectives,
        assessmentCriteria: input.assessmentCriteria,
        authorId: input.authorId,
      },
    }),
    prisma.lesson.update({ where: { id: input.lessonId }, data: { status: "DRAFT" } }),
  ]);

  return version;
}

// findFirst, not findUniqueOrThrow: lessonId arrives as form input from the
// admin's own page (app/admin/curriculum/actions.ts) -- a stale ID after a
// concurrent delete shouldn't produce an unhandled 500. Same fix already
// applied to Chart Lab's submitChartAnswer and the AI Tutor's conversation
// lookup, see those files' comments for the fuller writeup on why.
export async function transitionLessonStatus(lessonId: string, to: LessonStatusValue) {
  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId } });
  if (!lesson) return null;
  if (!canTransitionLessonStatus(lesson.status, to)) {
    throw new Error(`Cannot transition lesson from ${lesson.status} to ${to}`);
  }

  if (to === "PUBLISHED") {
    const latest = await prisma.lessonVersion.findFirst({
      where: { lessonId },
      orderBy: { version: "desc" },
    });
    if (!latest) throw new Error("Cannot publish a lesson with no content version");

    return prisma.$transaction(async (tx) => {
      await tx.lessonVersion.update({ where: { id: latest.id }, data: { publishedAt: new Date() } });
      return tx.lesson.update({
        where: { id: lessonId },
        data: { status: to, currentVersionId: latest.id },
      });
    });
  }

  return prisma.lesson.update({ where: { id: lessonId }, data: { status: to } });
}
