import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { submitChartAnswerAction, submitFollowUpResponseAction } from "./actions";

export default async function StudentChartLabPage() {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk".
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const exercises = await prisma.chartExercise.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      answers: {
        where: { studentId: session.sub },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-50">Chart Lab</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Look at the chart, say what you see. The AI won&apos;t grade you or hand over an answer —
        it asks one follow-up question to make you check your own reasoning.
      </p>

      {exercises.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
          No chart exercises yet.
        </p>
      )}

      <div className="mt-6 space-y-6">
        {exercises.map((ex) => {
          const answer = ex.answers[0];
          return (
            <div key={ex.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-sm font-medium text-neutral-100">{ex.title}</p>
              <p className="mt-1 text-xs text-neutral-400">{ex.prompt}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not eligible for next/image optimization */}
              <img src={ex.imageDataUrl} alt={ex.title} className="mt-3 w-full rounded-md" />

              {!answer && (
                <form action={submitChartAnswerAction} className="mt-4 space-y-2">
                  <input type="hidden" name="chartExerciseId" value={ex.id} />
                  <label className="block text-xs text-neutral-400">What do you see?</label>
                  <textarea
                    name="response"
                    required
                    rows={4}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Submit
                  </button>
                </form>
              )}

              {answer && (
                <div className="mt-4 space-y-3 border-t border-neutral-800 pt-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">You said</p>
                    <p className="mt-1 text-sm text-neutral-200">{answer.response}</p>
                  </div>
                  {answer.followUpQuestion && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Follow-up
                      </p>
                      <p className="mt-1 text-sm text-emerald-300">{answer.followUpQuestion}</p>
                    </div>
                  )}
                  {answer.followUpResponse ? (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Your reply
                      </p>
                      <p className="mt-1 text-sm text-neutral-200">{answer.followUpResponse}</p>
                    </div>
                  ) : (
                    answer.followUpQuestion && (
                      <form action={submitFollowUpResponseAction} className="space-y-2">
                        <input type="hidden" name="chartAnswerId" value={answer.id} />
                        <textarea
                          name="response"
                          required
                          rows={3}
                          placeholder="Your reply..."
                          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
                        >
                          Reply
                        </button>
                      </form>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
