import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { logoutAction } from "./actions";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/curriculum", label: "Curriculum" },
  { href: "/admin/knowledge", label: "Knowledge Base" },
  { href: "/admin/chat", label: "AI Assistant" },
  { href: "/admin/audit-log", label: "Audit Log" },
];

const COMING_SOON = ["Lead CRM", "Trading Journal", "Analytics", "Automations"];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk". getSession() itself is fine to import cross-module; only the
  // redirect() call needs to live here.
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold text-neutral-50">Trading School OS</p>
          <p className="text-xs text-neutral-500">{session.email}</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}

          <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wide text-neutral-600">
            Coming soon
          </p>
          {COMING_SOON.map((label) => (
            <span
              key={label}
              className="cursor-default rounded-md px-3 py-2 text-sm text-neutral-600"
              title="Not yet implemented"
            >
              {label}
            </span>
          ))}
        </nav>

        <form action={logoutAction}>
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
