import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { studentLoginAction } from "./actions";

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getStudentSession();
  if (session) redirect("/student");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-neutral-50">Trading School OS</h1>
        <p className="mt-1 text-sm text-neutral-400">Student sign in</p>

        {error && (
          <p className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
            Invalid email or password, or your account isn&apos;t set up for login yet.
          </p>
        )}

        <form action={studentLoginAction} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-neutral-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-emerald-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white transition hover:bg-emerald-500"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
