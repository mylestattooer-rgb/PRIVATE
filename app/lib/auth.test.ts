import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for Next's cookies() store, supporting the get/set/delete
// surface auth.ts actually uses. Keyed by cookie name so admin and student
// sessions can be asserted as independent of one another.
function makeCookieJar() {
  const store = new Map<string, string>();
  return {
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
    _raw: store,
  };
}

let jar: ReturnType<typeof makeCookieJar>;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => jar),
}));

vi.mock("server-only", () => ({}));

// No mock for next/navigation's redirect() here, deliberately: auth.ts has no
// requireAdmin()/requireStudent() helper that calls it, because a mocked
// redirect() in vitest throws correctly while the *real* Next.js 16.3.0 +
// Turbopack runtime does not when redirect() is called from a cross-module
// awaited helper (verified in-browser, see SECURITY.md "Known Next.js 16
// redirect quirk"). A unit test with a mock would have hidden that bug, not
// caught it — the redirect check belongs inline in each route/action, tested
// via the browser verification workflow, not here.

beforeEach(() => {
  jar = makeCookieJar();
  process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long!!";
  vi.resetModules();
});

describe("admin session", () => {
  it("round-trips a created session through getSession", async () => {
    const { createSession, getSession } = await import("./auth");
    await createSession({ sub: "admin-1", email: "admin@example.com", name: "Admin" });
    const session = await getSession();
    expect(session).toMatchObject({ sub: "admin-1", email: "admin@example.com", name: "Admin" });
  });

  it("returns null when no session cookie is set", async () => {
    const { getSession } = await import("./auth");
    expect(await getSession()).toBeNull();
  });

  it("returns null after destroySession", async () => {
    const { createSession, destroySession, getSession } = await import("./auth");
    await createSession({ sub: "admin-1", email: "admin@example.com", name: "Admin" });
    await destroySession();
    expect(await getSession()).toBeNull();
  });

  it("rejects a session token signed with a different secret", async () => {
    const { createSession } = await import("./auth");
    await createSession({ sub: "admin-1", email: "admin@example.com", name: "Admin" });

    process.env.SESSION_SECRET = "a-completely-different-secret-value!!";
    vi.resetModules();
    const { getSession } = await import("./auth");
    expect(await getSession()).toBeNull();
  });
});

describe("student session", () => {
  it("round-trips independently of the admin session cookie", async () => {
    const { createSession, createStudentSession, getSession, getStudentSession } = await import("./auth");

    await createSession({ sub: "admin-1", email: "admin@example.com", name: "Admin" });
    await createStudentSession({ sub: "student-1", email: "student@example.com", name: "Student" });

    const admin = await getSession();
    const student = await getStudentSession();
    expect(admin?.sub).toBe("admin-1");
    expect(student?.sub).toBe("student-1");
    // Two distinct cookies, not one shared session — this is the isolation
    // property ARCHITECTURE.md's "Auth: two principal types" relies on.
    expect(jar._raw.size).toBe(2);
  });

  it("destroying the student session leaves the admin session intact", async () => {
    const { createSession, createStudentSession, destroyStudentSession, getSession, getStudentSession } =
      await import("./auth");

    await createSession({ sub: "admin-1", email: "admin@example.com", name: "Admin" });
    await createStudentSession({ sub: "student-1", email: "student@example.com", name: "Student" });
    await destroyStudentSession();

    expect(await getStudentSession()).toBeNull();
    expect((await getSession())?.sub).toBe("admin-1");
  });
});
