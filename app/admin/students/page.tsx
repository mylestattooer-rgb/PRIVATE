import Link from "next/link";
import { prisma } from "@/app/lib/db";
import { createStudent } from "./actions";

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-neutral-700 text-neutral-200",
  TRIAL: "bg-blue-900 text-blue-300",
  ACTIVE: "bg-emerald-900 text-emerald-300",
  PAUSED: "bg-amber-900 text-amber-300",
  CHURNED: "bg-red-900 text-red-300",
};

export default async function StudentsPage() {
  const students = await prisma.student.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { notes: true, progress: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">Students</h1>
          <p className="mt-1 text-sm text-neutral-400">Student CRM — WORKING.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 bg-neutral-950">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-neutral-900">
                    <td className="px-4 py-3">
                      <Link href={`/admin/students/${s.id}`} className="text-neutral-100 hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-xs text-neutral-500">{s.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[s.status]}`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{s.source ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-400">{s._count.notes}</td>
                    <td className="px-4 py-3 text-neutral-400">{s.joinedAt.toLocaleDateString()}</td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                      No students yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 h-fit">
          <h2 className="text-sm font-semibold text-neutral-200">Add student</h2>
          <form action={createStudent} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-neutral-400">Name</label>
              <input
                name="name"
                required
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Email</label>
              <input
                name="email"
                type="email"
                required
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Status</label>
              <select
                name="status"
                defaultValue="LEAD"
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              >
                <option value="LEAD">Lead</option>
                <option value="TRIAL">Trial</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="CHURNED">Churned</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Source (optional)</label>
              <input
                name="source"
                placeholder="referral, ad, organic..."
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Add student
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
