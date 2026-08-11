import { redirect, notFound } from "next/navigation";
import { marked } from "marked";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { submitAnswerAction } from "./actions";

export default async function StudentLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk".
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const { lessonId } = await params;
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      currentVersion: true,
      module: true,
      questions: {
        orderBy: { createdAt: "asc" },
        include: {
          attempts: {
            where: { studentId: session.sub },
            orderBy: { attemptedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  // Students only ever see the published version — a DRAFT/REVIEW/ARCHIVED
  // lesson (or one with no published version yet) isn't available to them,
  // matching CURRICULUM_SYSTEM.md's versioning guarantee.
  if (!lesson || lesson.status !== "PUBLISHED" || !lesson.currentVersion) notFound();

  const html = await marked.parse(lesson.currentVersion.content);

  return (
    <div className="max-w-2xl">
      <p className="text-xs text-neutral-500">{lesson.module.title}</p>
      <h1 className="text-2xl font-semibold text-neutral-50">{lesson.title}</h1>

      <article
        className="doc-render mt-6 max-w-none rounded-lg border border-neutral-800 bg-neutral-900 p-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {lesson.questions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Check your understanding</h2>
          <div className="mt-3 space-y-4">
            {lesson.questions.map((q) => {
              const choices: string[] = JSON.parse(q.choices);
              const lastAttempt = q.attempts[0];

              return (
                <div key={q.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                  <p className="text-sm text-neutral-100">{q.prompt}</p>

                  {lastAttempt ? (
                    <div className="mt-3 space-y-1">
                      {choices.map((c, i) => (
                        <p
                          key={i}
                          className={`text-sm ${
                            i === q.correctIndex
                              ? "text-emerald-400"
                              : i === lastAttempt.selectedIndex
                                ? "text-red-400"
                                : "text-neutral-500"
                          }`}
                        >
                          {i === q.correctIndex ? "✓ " : i === lastAttempt.selectedIndex ? "✗ " : "· "}
                          {c}
                        </p>
                      ))}
                      <p className={`mt-2 text-xs ${lastAttempt.correct ? "text-emerald-400" : "text-red-400"}`}>
                        {lastAttempt.correct ? "Correct — +10 XP" : "Not quite."}
                        {q.explanation ? ` ${q.explanation}` : ""}
                      </p>
                    </div>
                  ) : (
                    <form action={submitAnswerAction} className="mt-3 space-y-2">
                      <input type="hidden" name="lessonId" value={lesson.id} />
                      <input type="hidden" name="questionId" value={q.id} />
                      {choices.map((c, i) => (
                        <label key={i} className="flex items-center gap-2 text-sm text-neutral-300">
                          <input type="radio" name="selectedIndex" value={i} required className="accent-emerald-500" />
                          {c}
                        </label>
                      ))}
                      <button
                        type="submit"
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                      >
                        Submit answer
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
