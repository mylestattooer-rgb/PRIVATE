---
title: Architecture — System Design
doc_type: architecture
status: mixed
updated: 2026-08-10
tags: [doc/architecture, status/mixed]
---

# ARCHITECTURE — Trading X

Status: mixed — written during Phase 0 (discovery) as a target architecture; the "Auth" and
"entitlements" sections below were then partially built in the same session (Phase 1's first
milestone) and are marked DONE where implemented. See [`PROJECT_STATE.md`](PROJECT_STATE.md) for verified current
build status and [`SECURITY.md`](SECURITY.md) for a real bug found and fixed while building this.

## Decision: keep the existing stack

Next.js 16 (App Router, Server Actions) + Tailwind v4, Prisma 6 + SQLite (dev) with a Postgres
migration path for production, custom signed-cookie JWT auth. This was chosen deliberately in
Phase 1 (see [`PROJECT_STATE.md`](PROJECT_STATE.md) "Key architectural decisions") and nothing about the Trading X
brief argues for a rewrite — "prefer boring, reliable technology over fashionable complexity" is
one of the brief's own non-negotiables. The stack is not yet proven at scale (no load testing, no
production deployment), but that's a scaling question for later phases, not a reason to swap
frameworks now.

**SQLite → Postgres**: SQLite is fine for a single-admin dev/demo tool. It will not survive real
concurrent student traffic (file-level locking, no real connection pooling) or multi-instance
deployment. This is a known, deliberately deferred migration — Prisma's schema-first approach
makes the swap a `datasource` + migration-regeneration change, not a rewrite, provided no
SQLite-specific SQL is used directly (none is, today). Do it when Phase 1 student auth work makes
concurrent access a reality, not before.

## Decision: modular monolith, domain-folder boundaries

One deploy, one database, clear internal seams — not microservices. This is both the brief's
explicit instruction (§3) and consistent with the root `quant_platform/ARCHITECTURE.md`'s existing
"deterministic core, pluggable domains" pattern elsewhere in this repo.

Target folder shape (grows incrementally, not built in one pass):

```
app/
  admin/               everything currently under app/admin/, unchanged
  student/
    login/              student login — deliberately NOT under (app)/, see Auth section below
    (app)/              route group — the gated student surface (dashboard, and everything
                        student-facing that follows); (app) itself carries no URL segment
  api/
  lib/
    domains/
      entitlements/     capability checks — DONE, see below
      learning/        courses, modules, lessons, prerequisites, versioning
      progression/      levels, concept mastery, XP
      journal/          journal entries, statistics
      ai-tutor/          the existing app/lib/ai/* becomes ai-tutor's implementation
      chart-lab/         chart exercises, annotation, AI questioning
      simulator/        replay engine, orders, risk metrics
      prop-prep/        rule profiles, evaluation simulator
      community/        posts, comments, reputation
    db.ts              unchanged — single Prisma client singleton, shared across domains
    audit.ts           unchanged — every domain writes through this, not its own logger
```

One correction from the original Phase 0 sketch: there is no `domains/auth/` folder. Session
logic stayed in `app/lib/auth.ts` (extended, not moved) — splitting it into `domains/` would have
added indirection with no second consumer to justify it, and auth is genuinely cross-cutting
infrastructure rather than a bounded business domain like the others in this list.

`app/lib/ai/` already exists as a de facto domain folder (`provider.ts` +
`retrieval.ts` behind a clean interface) — it's the existing proof this pattern works here, not a
new idea. Domains talk to each other through function calls within the monolith, not HTTP; the
boundary is "which folder owns this data's read/write logic," not a network boundary. This keeps
the option open to peel a domain out into its own service later (simulator is the most likely
candidate, given it may eventually need real historical market data infrastructure) without that
being a requirement now.

## Decision: entitlements as one central module, from day one — DONE

Per brief §32: never scatter `if (student.plan === "premium")` through route handlers.
`app/lib/domains/entitlements/` exposes `studentCan(studentId, capability)` (and a pure
`hasCapability()` for when the caller already has the plan's capability list). Capabilities are
string constants (`CAPABILITIES.USE_AI_TUTOR`, ...) stored comma-separated on a new `Plan` model,
not booleans on the student record — a pricing-tier change becomes a data change (which
capabilities a plan grants) rather than a code change. Built with exactly one real capability so
far (`USE_AI_TUTOR`), matching the "shape over completeness" call made in Phase 0 — more get added
as the features that need them (simulator, journal, ...) actually land.

## Auth: two principal types — DONE, one correction from the Phase 0 plan

The existing `app/lib/auth.ts` (`jose`-signed JWT in an httpOnly cookie) was extended, not
replaced — but **not** with the originally-planned `principalType` claim on one shared cookie.
Admin and student sessions use **separate cookies** (`ts_session` / `ts_student_session`) sharing
the same sign/verify plumbing internally, so the two can coexist independently in the same browser
and a student-scoped check can never accidentally succeed off an admin cookie. `getSession()` /
`getStudentSession()` return session data for their principal type; `requireAdminApi()` /
`requireStudentApi()` do the same for Route Handlers (return null, caller sends 401).

**No `requireAdmin()`/`requireStudent()` helper exists that redirects on the caller's behalf** —
that was the original plan, and it was built, but in-browser verification caught a real bug: in
this project's Next.js 16.3.0 + Turbopack setup, `redirect()` called from inside an awaited
cross-module helper does not propagate correctly (the component silently continues rendering with
a null session instead of redirecting — reproduced identically on the pre-existing admin path, not
specific to the new student code). Full writeup and the fix in [`SECURITY.md`](SECURITY.md)'s "Known Next.js 16
redirect quirk". The working pattern instead: every protected layout/page/action calls
`const session = await getSession(); if (!session) redirect(...)` **directly in its own body**,
using the data-only session getters above. This is more repetition than the originally-planned
shared guard, but it's the one pattern proven to actually redirect in this runtime — don't
"clean it up" into a shared helper without re-verifying in a real browser first.

Student auth landed as the first Phase 1 milestone (see [`ROADMAP.md`](ROADMAP.md)): `Student.passwordHash` /
`Student.authEnabledAt` (nullable — a LEAD/TRIAL CRM record can exist with no login yet, resolving
the question [`DATABASE.md`](DATABASE.md) §2.1 originally left open), `/student/login`, and a gated
`/student` dashboard proving the full pattern end-to-end (session → entitlement check →
student-scoped DB query).

## Event system: sketched now, built when a second consumer exists

Brief §49 asks for an internal event architecture (`LESSON_COMPLETED`, `QUIZ_PASSED`,
`ACHIEVEMENT_UNLOCKED`, etc.) so modules react without tight coupling. Building a generic event bus
before there are at least two independent consumers of the same event is premature — today nothing
in the codebase would consume these events. The extension point: `audit.ts`'s existing
"every domain writes through one shared logger" pattern is the natural place to grow an event
emitter from, once (for example) both progression *and* achievements need to react to the same
`LESSON_COMPLETED` fact. Noted here as a deliberate deferral, not an oversight.

## AI system integration

Full detail in [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md). At the architecture level: the AI layer is a bounded
subsystem (`domains/ai-tutor/`) that can read approved knowledge and student-scoped data through
explicit, narrow interfaces — it never gets raw database access, and it never performs
deterministic calculations (R-multiples, drawdown, XP, Trader Score) that plain code can do
reliably. This mirrors the root [`CLAUDE.md`](CLAUDE.md)'s "AI layer can only ever produce a Signal; only the
deterministic Risk Manager + Execution Adapter can touch a broker" rule from the trading side of
this repo — same shape, applied to the education side: AI can only ever produce an *interpretation
or a question*, never an authoritative score or a silent database mutation.

## What this document does not do

It does not commit to microservices, a message queue, a vector database, or a specific historical
market-data provider — none of those are justified by anything built or actively being built
today. `EXTERNAL INTEGRATION LAYER` (brief §47) and `TRADING X API` (§48) get one line here:
external integrations (TradingView, MT5, market data, payments) and any future non-web client
(mobile, desktop) should only ever talk to this codebase through the same server-enforced
auth/entitlement checks the web app uses — no separate trust path. Design work on those happens
when a concrete integration is actually being built, not speculatively now.
