import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NEEDS_REVIEW: "Needs review",
};

export default async function StudentDashboardPage() {
  // Defense in depth: the (app)/layout.tsx above already gates this route,
  // but redirect() must be called directly in each component body (see
  // SECURITY.md), so this page re-checks rather than trusting the layout to
  // have passed a guaranteed-non-null session down.
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const [student, progress, aiTutorEnabled] = await Promise.all([
    prisma.student.findUnique({ where: { id: session.sub }, select: { name: true, status: true } }),
    prisma.moduleProgress.findMany({
      where: { studentId: session.sub },
      include: { module: true },
      orderBy: { module: { orderIndex: "asc" } },
    }),
    studentCan(session.sub, CAPABILITIES.USE_AI_TUTOR),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-50">Welcome, {student?.name ?? session.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        This is a Phase 1 proof-of-pattern dashboard — full &ldquo;Terminal&rdquo; home per
        PRODUCT_SPEC.md comes in a later phase.
      </p>

      <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-sm text-neutral-300">
          AI Tutor access:{" "}
          <span className={aiTutorEnabled ? "text-emerald-400" : "text-neutral-500"}>
            {aiTutorEnabled ? "enabled" : "not on your plan yet"}
          </span>
        </p>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Curriculum progress
      </h2>
      {progress.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No modules started yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
          {progress.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-neutral-200">{p.module.title}</span>
              <span className="text-xs text-neutral-500">
                {STATUS_LABEL[p.status] ?? p.status}
                {p.score != null ? ` · ${p.score}%` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
