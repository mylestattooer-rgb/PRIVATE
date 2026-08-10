import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { studentLogoutAction } from "./actions";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk". getStudentSession() itself is fine to import cross-module.
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold text-neutral-50">Trading School OS</p>
          <p className="text-xs text-neutral-500">{session.email}</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <span className="rounded-md bg-neutral-800 px-3 py-2 text-sm text-white">Dashboard</span>
          <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wide text-neutral-600">
            Coming soon
          </p>
          {["Lessons", "AI Tutor", "Journal", "Chart Lab"].map((label) => (
            <span
              key={label}
              className="cursor-default rounded-md px-3 py-2 text-sm text-neutral-600"
              title="Not yet implemented"
            >
              {label}
            </span>
          ))}
        </nav>

        <form action={studentLogoutAction}>
          <button
            type="submit"
            className="mt-4 w-full rounded-md border border-neutral-800 px-3 py-2 text-left text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
