import { prisma } from "@/app/lib/db";
import { allowedNextLessonStatuses, type LessonStatusValue } from "@/app/lib/domains/learning/status";
import {
  createLessonAction,
  addLessonVersionAction,
  transitionLessonAction,
  createQuestionAction,
} from "./actions";

const STATUS_STYLE: Record<LessonStatusValue, string> = {
  DRAFT: "bg-neutral-800 text-neutral-300",
  REVIEW: "bg-amber-900 text-amber-300",
  PUBLISHED: "bg-emerald-900 text-emerald-300",
  ARCHIVED: "bg-neutral-800 text-neutral-500",
};

const STATUS_LABEL: Record<LessonStatusValue, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export default async function CurriculumPage() {
  const modules = await prisma.module.findMany({
    orderBy: { orderIndex: "asc" },
    include: {
      lessons: {
        orderBy: { orderIndex: "asc" },
        include: {
          versions: { orderBy: { version: "desc" }, take: 1 },
          questions: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-50">Curriculum</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Versioned lesson authoring — editing a lesson creates a new version rather than overwriting
        what&apos;s published, so students mid-lesson never see content shift under them. See
        CURRICULUM_SYSTEM.md.
      </p>

      <div className="mt-6 space-y-8">
        {modules.map((mod) => (
          <div key={mod.id}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{mod.title}</h2>

            <div className="mt-3 space-y-3">
              {mod.lessons.map((lesson) => {
                const latest = lesson.versions[0];
                const nextStatuses = allowedNextLessonStatuses(lesson.status);
                return (
                  <details key={lesson.id} className="rounded-lg border border-neutral-800 bg-neutral-900">
                    <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
                      <span className="text-sm font-medium text-neutral-100">{lesson.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-neutral-500">v{latest?.version ?? 0}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[lesson.status]}`}>
                          {STATUS_LABEL[lesson.status]}
                        </span>
                      </span>
                    </summary>

                    <div className="border-t border-neutral-800 px-4 py-3 space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {nextStatuses.map((to) => (
                          <form key={to} action={transitionLessonAction}>
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <input type="hidden" name="to" value={to} />
                            <button
                              type="submit"
                              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
                            >
                              {to === "PUBLISHED" ? "Publish" : `Move to ${STATUS_LABEL[to]}`}
                            </button>
                          </form>
                        ))}
                      </div>

                      <form action={addLessonVersionAction} className="space-y-2">
                        <input type="hidden" name="lessonId" value={lesson.id} />
                        <label className="block text-xs text-neutral-400">
                          Content (saving creates version {(latest?.version ?? 0) + 1} and resets status to
                          Draft)
                        </label>
                        <textarea
                          name="content"
                          rows={6}
                          defaultValue={latest?.content ?? ""}
                          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
                        >
                          Save new version
                        </button>
                      </form>

                      <div className="border-t border-neutral-800 pt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          Quiz questions ({lesson.questions.length})
                        </p>
                        <ul className="mt-2 space-y-2">
                          {lesson.questions.map((q) => {
                            const choices: string[] = JSON.parse(q.choices);
                            return (
                              <li key={q.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                                <p className="text-sm text-neutral-200">{q.prompt}</p>
                                <ul className="mt-1 space-y-0.5">
                                  {choices.map((c, i) => (
                                    <li
                                      key={i}
                                      className={`text-xs ${
                                        i === q.correctIndex ? "text-emerald-400" : "text-neutral-500"
                                      }`}
                                    >
                                      {i === q.correctIndex ? "✓ " : "· "}
                                      {c}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            );
                          })}
                        </ul>

                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-neutral-400">+ New question</summary>
                          <form action={createQuestionAction} className="mt-2 space-y-2">
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <input
                              name="prompt"
                              required
                              placeholder="Question prompt"
                              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                            />
                            <textarea
                              name="choices"
                              rows={4}
                              required
                              placeholder={"One choice per line, at least 2\ne.g.\nUp\nDown\nSideways"}
                              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                            />
                            <input
                              name="correctIndex"
                              type="number"
                              min={0}
                              required
                              placeholder="Correct choice number (0 = first line)"
                              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                            />
                            <input
                              name="explanation"
                              placeholder="Explanation shown after answering (optional)"
                              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                            />
                            <button
                              type="submit"
                              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
                            >
                              Add question
                            </button>
                          </form>
                        </details>
                      </div>
                    </div>
                  </details>
                );
              })}

              {mod.lessons.length === 0 && (
                <p className="rounded-lg border border-dashed border-neutral-800 p-4 text-center text-xs text-neutral-500">
                  No lessons yet in this module.
                </p>
              )}

              <details className="rounded-lg border border-dashed border-neutral-800">
                <summary className="cursor-pointer px-4 py-2 text-xs text-neutral-400">+ New lesson</summary>
                <form action={createLessonAction} className="space-y-2 px-4 pb-4">
                  <input type="hidden" name="moduleId" value={mod.id} />
                  <input
                    name="title"
                    required
                    placeholder="Lesson title"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                  />
                  <textarea
                    name="content"
                    rows={4}
                    required
                    placeholder="# Lesson content..."
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Create draft lesson
                  </button>
                </form>
              </details>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
