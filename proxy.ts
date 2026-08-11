import { NextRequest, NextResponse } from "next/server";

// Basic per-IP rate limiting on the endpoints that were public-reachable and
// unthrottled (SECURITY.md #2.2): login is a brute-force target, chat is a
// cost/abuse target. In-memory, single-instance only — matches this app's
// current SQLite-single-instance architecture (see ARCHITECTURE.md "SQLite
// -> Postgres"); revisit together (e.g. a shared store) when that migration
// happens, since a second instance would get its own independent counters.
const WINDOW_MS = 60_000;
const LIMITS: Record<string, number> = {
  "/login": 10,
  "/student/login": 10,
  "/api/chat": 30,
  "/api/student/chat": 30,
};

const hits = new Map<string, { count: number; resetAt: number }>();
// No setInterval here (a top-level timer in a Proxy module is a footgun
// across Next.js's dev/build module reinstantiation) — instead, opportunistically
// sweep expired entries once the map grows past a threshold, on whichever
// request happens to trigger it.
const SWEEP_THRESHOLD = 1000;

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const limit = LIMITS[path];
  if (!limit || request.method !== "POST") return NextResponse.next();

  const key = `${path}:${clientIp(request)}`;
  const now = Date.now();

  if (hits.size > SWEEP_THRESHOLD) {
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }

  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return NextResponse.next();
  }

  if (entry.count >= limit) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) } }
    );
  }

  entry.count += 1;
  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/student/login", "/api/chat", "/api/student/chat"],
};
