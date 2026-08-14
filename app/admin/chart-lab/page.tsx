import { prisma } from "@/app/lib/db";
import { createChartExerciseAction } from "./actions";

export default async function AdminChartLabPage() {
  const [exercises, concepts] = await Promise.all([
    prisma.chartExercise.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { answers: true } }, concepts: true },
    }),
    prisma.concept.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-50">Chart Lab</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Upload a chart and a task (&ldquo;mark the most recent liquidity sweep&rdquo;,
        &ldquo;what&apos;s the bias here?&rdquo;). The AI never grades or reveals the answer — it
        asks one Socratic follow-up question to make the student examine their own reasoning. See
        AI_ARCHITECTURE.md.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {exercises.map((ex) => (
            <div key={ex.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not eligible for next/image optimization */}
                <img src={ex.imageDataUrl} alt={ex.title} className="h-24 w-32 rounded object-cover" />
                <div>
                  <p className="text-sm font-medium text-neutral-100">{ex.title}</p>
                  <p className="mt-1 text-xs text-neutral-400">{ex.prompt}</p>
                  <p className="mt-2 text-xs text-neutral-500">
                    {ex._count.answers} student answer{ex._count.answers === 1 ? "" : "s"}
                  </p>
                  {ex.concepts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ex.concepts.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {exercises.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              No chart exercises yet.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 h-fit">
          <h2 className="text-sm font-semibold text-neutral-200">New exercise</h2>
          <form action={createChartExerciseAction} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-neutral-400">Title</label>
              <input
                name="title"
                required
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Task</label>
              <textarea
                name="prompt"
                required
                rows={3}
                placeholder="What do you see? Mark the most recent liquidity sweep."
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Chart image (.png, .jpg, .webp, max 5MB)</label>
              <input
                name="image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                className="mt-1 w-full text-xs text-neutral-300 file:mr-2 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-100"
              />
            </div>
            {concepts.length > 0 && (
              <div>
                <label className="block text-xs text-neutral-400">Concepts assessed (optional)</label>
                <div className="mt-1 space-y-1.5 rounded-md border border-neutral-700 bg-neutral-950 p-2.5">
                  {concepts.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        name="conceptIds"
                        value={c.id}
                        className="rounded border-neutral-600 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button
              type="submit"
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Create exercise
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
