import { redirect } from "next/navigation";
import Link from "next/link";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";
import { totalXp } from "@/app/lib/domains/progression/xp";
import { levelForXp, xpToNextLevel } from "@/app/lib/domains/progression/level";

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

  const [student, progress, aiTutorEnabled, xpEvents, levels, unlockedAchievements, publishedLessons, masteries] =
    await Promise.all([
      prisma.student.findUnique({ where: { id: session.sub }, select: { name: true, status: true } }),
      prisma.moduleProgress.findMany({
        where: { studentId: session.sub },
        include: { module: true },
        orderBy: { module: { orderIndex: "asc" } },
      }),
      studentCan(session.sub, CAPABILITIES.USE_AI_TUTOR),
      prisma.xpEvent.findMany({ where: { studentId: session.sub }, select: { amount: true } }),
      prisma.level.findMany(),
      prisma.userAchievement.findMany({
        where: { studentId: session.sub },
        include: { achievement: true },
        orderBy: { unlockedAt: "desc" },
      }),
      prisma.lesson.findMany({
        where: { status: "PUBLISHED" },
        include: { module: true },
        orderBy: [{ module: { orderIndex: "asc" } }, { orderIndex: "asc" }],
      }),
      prisma.conceptMastery.findMany({
        where: { studentId: session.sub },
        include: { concept: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const xp = totalXp(xpEvents);
  const level = levelForXp(xp, levels);
  const next = xpToNextLevel(xp, levels);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-50">Welcome, {student?.name ?? session.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        This is a Phase 1-2 proof-of-pattern dashboard — full &ldquo;Terminal&rdquo; home per
        PRODUCT_SPEC.md comes in a later phase.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-xs text-neutral-500">Level</p>
          <p className="mt-1 text-lg font-semibold text-neutral-50">{level?.name ?? "Unranked"}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {xp} XP{next ? ` · ${next.remaining} to ${next.next.name}` : " · max level"}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-xs text-neutral-500">AI Tutor access</p>
          <p className={`mt-1 text-lg font-semibold ${aiTutorEnabled ? "text-emerald-400" : "text-neutral-500"}`}>
            {aiTutorEnabled ? "Enabled" : "Not on plan"}
          </p>
        </div>
      </div>

      {unlockedAchievements.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {unlockedAchievements.map((ua) => (
            <span
              key={ua.id}
              className="rounded-full border border-amber-800 bg-amber-950 px-3 py-1 text-xs text-amber-300"
              title={ua.achievement.description ?? undefined}
            >
              🏅 {ua.achievement.name}
            </span>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Lessons</h2>
      {publishedLessons.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No published lessons yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
          {publishedLessons.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <Link href={`/student/lessons/${l.id}`} className="text-sm text-neutral-200 hover:underline">
                {l.title}
              </Link>
              <p className="mt-0.5 text-xs text-neutral-500">{l.module.title}</p>
            </li>
          ))}
        </ul>
      )}

      {masteries.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Concept mastery
          </h2>
          <ul className="mt-2 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
            {masteries.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-neutral-200">{m.concept.name}</span>
                <span className="text-xs text-neutral-500">{m.state.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}

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
