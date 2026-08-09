import { notFound } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { addNote, updateModuleProgress, updateStudentStatus } from "../actions";

const STATUSES = ["LEAD", "TRIAL", "ACTIVE", "PAUSED", "CHURNED"] as const;
const PROGRESS_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NEEDS_REVIEW"] as const;

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      notes: { orderBy: { createdAt: "desc" }, include: { author: true } },
      progress: { include: { module: true } },
    },
  });
  if (!student) notFound();

  const modules = await prisma.module.findMany({ orderBy: { orderIndex: "asc" } });
  const progressByModule = new Map(student.progress.map((p) => [p.moduleId, p]));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">{student.name}</h1>
          <p className="mt-1 text-sm text-neutral-400">{student.email}</p>
        </div>
        <form action={updateStudentStatus} className="flex items-center gap-2">
          <input type="hidden" name="studentId" value={student.id} />
          <select
            name="status"
            defaultValue={student.status}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-700"
          >
            Update status
          </button>
        </form>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-neutral-200">Curriculum progress</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Sample curriculum — placeholder module titles until real curriculum is provided.
          </p>
          <div className="mt-3 space-y-2">
            {modules.map((m) => {
              const p = progressByModule.get(m.id);
              return (
                <form
                  key={m.id}
                  action={updateModuleProgress}
                  className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3"
                >
                  <input type="hidden" name="studentId" value={student.id} />
                  <input type="hidden" name="moduleId" value={m.id} />
                  <span className="text-sm text-neutral-200">{m.title}</span>
                  <div className="flex items-center gap-2">
                    <select
                      name="status"
                      defaultValue={p?.status ?? "NOT_STARTED"}
                      className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                    >
                      {PROGRESS_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-700"
                    >
                      Save
                    </button>
                  </div>
                </form>
              );
            })}
            {modules.length === 0 && (
              <p className="text-sm text-neutral-500">No curriculum modules seeded yet.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-neutral-200">Notes</h2>
          <form action={addNote} className="mt-3">
            <input type="hidden" name="studentId" value={student.id} />
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Add a note about this student..."
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Add note
            </button>
          </form>

          <div className="mt-4 space-y-3">
            {student.notes.map((n) => (
              <div key={n.id} className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
                <p className="text-sm text-neutral-200 whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {n.author?.name ?? "system"} · {n.createdAt.toLocaleString()}
                </p>
              </div>
            ))}
            {student.notes.length === 0 && <p className="text-sm text-neutral-500">No notes yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
