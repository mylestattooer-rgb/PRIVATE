import { prisma } from "@/app/lib/db";

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-neutral-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const [studentCount, activeStudents, docCount, sampleDocCount, reviewDocCount, conversationCount, recentLogs] =
    await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { status: "ACTIVE" } }),
      prisma.document.count({ where: { status: "READY" } }),
      prisma.document.count({ where: { isSample: true } }),
      prisma.document.count({ where: { needsReview: true } }),
      prisma.conversation.count(),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { actor: true },
      }),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-50">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-400">Basic admin overview — WORKING (live counts from the database).</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Students" value={studentCount} hint={`${activeStudents} active`} />
        <StatCard label="Knowledge docs" value={docCount} hint={sampleDocCount ? `${sampleDocCount} sample/placeholder` : undefined} />
        <StatCard label="Needs review" value={reviewDocCount} hint={reviewDocCount ? "extracted, unconfirmed" : "all confirmed"} />
        <StatCard label="AI conversations" value={conversationCount} />
        <StatCard label="AI provider" value={process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock"} hint={process.env.ANTHROPIC_API_KEY ? "live answers" : "no API key set"} />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-200">Recent activity</h2>
        <div className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
          {recentLogs.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">No activity yet.</p>
          )}
          {recentLogs.map((log) => (
            <div key={log.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{log.action}</span>
                <span className="ml-2 text-neutral-300">{log.detail}</span>
              </div>
              <span className="text-xs text-neutral-500">
                {log.actor?.name ?? "system"} · {log.createdAt.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
