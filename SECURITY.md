# SECURITY — Trading X

Status: mixed — section 1 describes what's actually enforced today; section 2 is Phase 0
discovery for what Phase 1+ must add. This document extends `vault/00-Home/SECURITY.md`'s
repo-wide posture to this subproject specifically; it doesn't restate rules that apply unchanged
(secrets handling, prompt-injection defense as a general concept, live-trading barrier — all
already covered there and equally binding here).

## Known Next.js 16 redirect quirk (found 2026-08-10, fixed same session)

While building Phase 1 student auth, in-browser verification (not just unit tests) caught a real
bug: in this project's Next.js 16.3.0 + Turbopack dev setup, calling `redirect()` from
`next/navigation` **inside an awaited helper function defined in a different module** than the
Server Component/Server Action does not propagate — the component silently continues rendering
with a null session instead of redirecting. Confirmed via a debug trace: a `console.log`
immediately before the `redirect()` call fired with the correct null session, but nothing after
it did, and the component still returned normally rather than throwing — reproduced identically
on the pre-existing admin path (`requireAdmin()`), not something introduced by the new student
code.

**Practical impact at the time it was found**: every protected page happened to crash (500) on
unauthenticated access rather than leak data, because each layout immediately dereferenced
`session.email`. That was luck, not a guarantee — a future page that didn't immediately
dereference the session could have rendered protected content, or a Server Action that didn't
immediately dereference `session.sub` could have performed a mutation, for an unauthenticated
caller. Treated as a real auth-bypass-class bug, not a cosmetic one.

**Fix applied**: removed the `requireAdmin()`/`requireStudent()` helpers that redirected on the
caller's behalf. Every protected layout, page, and Server Action now calls
`const session = await getSession(); if (!session) redirect(...)` directly in its own body —
`getSession()`/`getStudentSession()` (data-only, no redirect) remain safe to import cross-module,
verified working correctly. `requireAdminApi()`/`requireStudentApi()` for Route Handlers were
never affected (they return null and let the caller send 401; no `redirect()` call involved).
Verified via a full in-browser pass: unauthenticated `/admin` and `/student` both now correctly
redirect (307) to their login pages, and an authenticated admin's mutating Server Action
(`createStudent`) still works end-to-end.

**Lesson for future sessions**: this is exactly the kind of thing `AGENTS.md`'s "this is NOT the
Next.js you know" warning is about — a unit test mocking `next/navigation`'s `redirect()` would
have passed and hidden this, since the mock throws correctly even though the real runtime doesn't
propagate it the same way from a cross-module call. Caught only by the mandatory in-browser
verification workflow. Do not reintroduce a cross-module redirecting auth guard without
re-verifying in a real browser first.

## 1. What's real today

- **Auth**: signed JWT in an httpOnly cookie (`jose`), verified server-side on every admin route
  via an inline `if (!session) redirect(...)` check in each layout/page/action (see "Known Next.js
  16 redirect quirk" above for why it's inline rather than a shared cross-module guard), plus
  `requireAdminApi()` for Route Handlers, which returns null → caller sends 401. Passwords hashed
  with `bcryptjs`. Student auth now exists too (Phase 1, same pattern, separate cookie) — see
  `ARCHITECTURE.md` and section 2 below for what's still pending on top of it.
- **Audit logging**: every login, AI query/response, and student/document mutation writes an
  `AuditLog` row (actor, action, human-readable detail, JSON metadata). This is a real, append-only
  trail today, not aspirational.
- **Secrets**: per the root `SECURITY.md`, `trading_school/.env`'s `SESSION_SECRET` and seed admin
  password are correctly gitignored and uncommitted — flagged there as a hygiene item (rotate the
  weak seed default before this project handles real student data), not an incident. Nothing new to
  add here beyond: that rotation is a Phase 1 precondition, not optional polish, once real students
  exist.
- **Human-approval gate**: the `Approval` schema exists for sensitive AI-proposed actions, per the
  root `AI OPERATING MANUAL.md`'s general "AI proposes, human approves" pattern — currently unused
  since no automation feature produces requests yet (see `PROJECT_STATE.md`).
- **Sample content labeling**: `Document.isSample`/`needsReview` prevent placeholder or unconfirmed
  content from being presented as real methodology — a data-integrity control that doubles as a
  security one, since it prevents the AI from confidently asserting things nobody has verified.

## 2. What Phase 1+ must add (not yet implemented)

### 2.1 Student data isolation — DONE, applied consistently across every domain built since

Student auth landed (see above): `getStudentSession()`/`requireStudentApi()` return the
authenticated student's own ID from the verified session cookie. Every student-scoped domain
built since filters by that ID at the query layer, never a client-supplied one — `ModuleProgress`
(Phase 1), `JournalTrade`/`AiInsight` (Phase 3, `deleteTrade` takes studentId as a mandatory
filter param), `QuestionAttempt`/`ConceptMastery` (Phase 2), and `Conversation`/`Message` for the
student AI Tutor (Phase 4). The last one caught a real bug: the chat route originally used
`findUniqueOrThrow` for an existing-conversation lookup scoped by studentId — isolation itself was
never broken (a mismatched ID correctly matched nothing), but the unhandled exception on that miss
produced a raw 500 instead of a clean 404. Fixed via `findFirst` + explicit not-found response;
full writeup in `AI_ARCHITECTURE.md`. Verified in-browser for both journal and chat: a second
student's view is empty, and a direct hijack attempt (real `fetch()` with another student's
resource ID) is correctly rejected with no data returned.

### 2.2 Rate limiting — DONE

`proxy.ts` (Next.js 16's `middleware.ts` successor) throttles `POST /login`, `POST /student/login`,
and `POST /api/chat` per-IP with an in-memory sliding window (10/min for the two login endpoints,
30/min for chat), returning 429 with `Retry-After` once exceeded. Verified in-browser: 10 rapid
login attempts succeed through to the app, the 11th+ are blocked, and the page doesn't break when
blocked. Deliberately in-memory and per-process — matches this app's current single-instance
SQLite architecture (see `ARCHITECTURE.md`); revisit with a shared store (Redis, etc.) alongside
the Postgres/multi-instance migration, since a second instance would keep independent counters.

### 2.3 Upload validation (Phase 5, Chart Lab) — DONE

Chart-image uploads (brief §9) are validated in `createChartExerciseAction`
(`app/admin/chart-lab/actions.ts`): MIME type allowlist (png/jpeg/webp only), 5MB size cap, both
checked server-side before the file is ever touched. Image content is stored and treated as
opaque — the raw bytes become a `data:` URL in the DB and are never parsed as executable; in
real-provider mode the image isn't sent to the AI at all (see `AI_ARCHITECTURE.md`'s Chart Lab
section), so there's currently no path for image content to influence the AI system prompt.

### 2.4 AI-as-untrusted-subsystem, applied concretely

Full reasoning in `AI_ARCHITECTURE.md`; the security-specific requirements: the AI never receives
raw database access (reads go through retrieval/citation interfaces only); uploaded documents and
community posts are untrusted input that cannot alter system instructions no matter how they're
phrased (same prompt-injection stance as the root `SECURITY.md`, applied to a new input channel);
AI-proposed actions with real effects route through `Approval`, never execute directly.

### 2.5 Entitlement checks are server-side only — DONE for the capability built so far

`app/lib/domains/entitlements/` (`studentCan()`) is server-only (`import "server-only"`) and reads
the plan capability from the database via the session-derived student ID, not from any client
input — the pattern this section called for. Applies unchanged as more capabilities are added:
every check happens in the Server Action / Route Handler / Server Component, never trusted from
client state, since entitlements gate paid features (brief §31/§32) and a client-side-only check
would be a revenue leak.

### 2.6 Privacy controls (Phase 8+, ahead of any real community/commercial launch)

Brief §36: data export, account deletion, AI opt-out, journal privacy (private by default — never
automatically promoted to community content, matching the trust-level design in
`AI_ARCHITECTURE.md`). UK GDPR applies once real student data is collected — this needs to be in
place before any non-demo student data exists, not retrofitted after.

## What this document deliberately does not do

It doesn't invent new incidents or claim controls exist that don't. Where the root `SECURITY.md`
documents a repo-wide gap honestly (e.g. Meridian-7's Pine/MQL5 code having no code-level
live-trading barrier), the equivalent honesty here is: this subproject currently has **zero
student-facing attack surface**, because it has zero student-facing auth. That is the actual
current security posture — not a vulnerability, but a scope note that changes the moment section
2.1 ships.
