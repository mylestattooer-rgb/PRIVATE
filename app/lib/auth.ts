import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const ADMIN_COOKIE_NAME = "ts_session";
const STUDENT_COOKIE_NAME = "ts_student_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function secretKey() {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET"));
}

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
};

// Shared sign/verify/cookie plumbing for both principal types. Admin and
// student sessions use separate cookies (not one cookie with a role claim)
// so the two can coexist independently in the same browser and so a
// student-scoped check can never accidentally succeed off an admin cookie
// or vice versa — see ARCHITECTURE.md "Auth: two principal types".

async function createSessionCookie(cookieName: string, payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

async function destroySessionCookie(cookieName: string) {
  const store = await cookies();
  store.delete(cookieName);
}

async function getSessionFromCookie(cookieName: string): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// --- Admin sessions ----------------------------------------------------------

export async function createSession(payload: SessionPayload) {
  return createSessionCookie(ADMIN_COOKIE_NAME, payload);
}

export async function destroySession() {
  return destroySessionCookie(ADMIN_COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  return getSessionFromCookie(ADMIN_COOKIE_NAME);
}

// There is deliberately no requireAdmin()/requireStudent() helper that calls
// redirect() on the caller's behalf. Verified in this Next.js 16.3.0 +
// Turbopack dev setup: redirect() called from inside an awaited function in a
// *different* module than the Server Component does not propagate — the
// component silently continues rendering with a null session instead of
// redirecting (confirmed via the debug trace in SECURITY.md's "Known Next.js
// 16 redirect quirk"). Every protected layout/page must call
// `if (!session) redirect(...)` directly in its own body, using getSession()/
// getStudentSession() below for the data only. Do not reintroduce a
// cross-module redirecting guard without re-verifying this in-browser first.

/** For Route Handlers: never redirects, caller returns 401 on null. */
export async function requireAdminApi(): Promise<SessionPayload | null> {
  return getSession();
}

// --- Student sessions (Phase 1, ARCHITECTURE.md) -----------------------------

export async function createStudentSession(payload: SessionPayload) {
  return createSessionCookie(STUDENT_COOKIE_NAME, payload);
}

export async function destroyStudentSession() {
  return destroySessionCookie(STUDENT_COOKIE_NAME);
}

export async function getStudentSession(): Promise<SessionPayload | null> {
  return getSessionFromCookie(STUDENT_COOKIE_NAME);
}

/** For Route Handlers: never redirects, caller returns 401 on null. */
export async function requireStudentApi(): Promise<SessionPayload | null> {
  return getStudentSession();
}
