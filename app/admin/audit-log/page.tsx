import { prisma } from "@/app/lib/db";

export default async function AuditLogPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: true },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-50">Audit Log</h1>
      <p className="mt-1 text-sm text-neutral-400">
        WORKING — every AI query/response, login, student change, and document upload is logged here.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800 bg-neutral-950">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-2 whitespace-nowrap text-xs text-neutral-500">
                  {log.createdAt.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-neutral-300">{log.actor?.name ?? "system"}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{log.action}</span>
                </td>
                <td className="px-4 py-2 text-neutral-400">{log.detail}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
