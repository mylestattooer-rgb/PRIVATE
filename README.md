# Trading School OS

An AI-powered operating system for a day-trading education business: an admin side (student
CRM, knowledge base, AI assistant, audit log) and a student-facing app (versioned lessons and
quizzes with XP/levels/achievements, a trading journal with AI-generated insights, an AI Tutor
grounded in the school's own methodology, and Chart Lab — upload a chart, the AI asks Socratic
follow-up questions instead of grading).

Phases 0-5 of a larger vision are built (see `PROJECT_STATE.md` for the full breakdown of
what's WORKING / MOCKED / NOT YET IMPLEMENTED, and `ROADMAP.md` for what's next). No automated
trade execution exists or is planned — this is an educational/operational tool.

## Stack

- **Next.js 16** (App Router, TypeScript, Server Actions) + **Tailwind CSS v4**
- **Prisma 6** + **SQLite** (`prisma/dev.db`) — zero external infra to run locally
- **Custom session auth** (signed JWT cookie via `jose` + `bcryptjs`) — not NextAuth/Auth.js,
  see "Why not NextAuth" below
- **AI provider abstraction** (`app/lib/ai/provider.ts`): defaults to a local mock provider;
  set `ANTHROPIC_API_KEY` to enable real generative answers via the Anthropic Messages API
- **Retrieval** (`app/lib/ai/retrieval.ts`): local TF-IDF cosine similarity over uploaded
  knowledge-base chunks — no embeddings API, runs entirely in-process

## Quick start

```bash
cd trading_school
npm install
cp .env.example .env        # already done for you locally; regenerate SESSION_SECRET for real use
npx prisma migrate dev      # creates prisma/dev.db and applies schema + seed
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`.

**Demo admin login:** `admin@tradingschool.local` / `ChangeMe123!` (from `.env`'s
`ADMIN_EMAIL` / `ADMIN_SEED_PASSWORD`, applied by `prisma/seed.ts`).

**Demo student login** (`/student/login`, separate session from admin): any ACTIVE seeded
student's email (e.g. `ava.whitfield@example.com`) / `ChangeMe123!` (`STUDENT_SEED_PASSWORD`
if set, same default otherwise). TRIAL/PAUSED/LEAD demo students exist in the CRM but
deliberately can't log in — see `PROJECT_STATE.md`.

To re-seed at any time: `npm run db:seed`. To inspect the database visually: `npm run db:studio`.
To run the test suite: `npm test` (integration tests use a separate `prisma/test.db`, never
`dev.db` — see `prisma/test-db.ts`).

## What's WORKING vs MOCKED vs NOT YET IMPLEMENTED

See `PROJECT_STATE.md` for the full breakdown. Short version: everything built through Phase 5
is real (live database, real retrieval, real auth, real XP/journal/quiz grading) — the only
mocked piece is AI *generation* (not retrieval) when `ANTHROPIC_API_KEY` is unset, and that's
labeled in the UI itself, not just in docs. Not yet built: trading simulator, community,
prop-firm prep, payments, and school-wide analytics (Phases 6-10, all `NOT STARTED`).

## Why not NextAuth

`create-next-app` scaffolded on Next.js 16, which is very new. `next-auth@beta` (Auth.js v5)
compatibility with Next 16 wasn't something to gamble on for a single-admin, credentials-only
internal tool, so auth is a small hand-rolled signed-cookie session instead
(`app/lib/auth.ts`, ~70 lines, using `jose` for JWT signing). Simpler, fewer moving parts,
nothing to upgrade later.

## Why Prisma 6, not 7

Prisma 7 (released very recently) makes driver adapters mandatory even for local SQLite —
unnecessary complexity for a single-file dev database. Pinned to the stable 6.x line instead.
See `prisma/schema.prisma` header comment.

## Project layout

```
app/
  lib/
    db.ts                Prisma client singleton
    auth.ts               session create/verify/destroy (custom, not NextAuth) — separate
                           cookies for admin vs. student, see ARCHITECTURE.md
    audit.ts               audit log writer
    ai/
      provider.ts           AI provider interface + Mock/Anthropic implementations,
                             plus Chart Lab's socraticFollowUp()
      retrieval.ts           TF-IDF chunking + retrieval over the knowledge base
    domains/                one folder per bounded domain (ARCHITECTURE.md "modular
                             monolith") — pure logic + DB-write functions live together,
                             Server Actions/routes are the only callers
      entitlements/           Plan-based capability checks (studentCan())
      learning/                 lesson versioning + status state machine
      assessment/               quiz grading
      progression/               XP ledger, levels, achievements, concept mastery
      journal/                    trade CRUD, deterministic stats, AI insights
      chartlab/                    exercise CRUD, Socratic answer flow
  login/                    admin login page + server action
  admin/
    layout.tsx              session guard + nav shell
    page.tsx                 dashboard
    students/                  CRM: list, create, profile, notes, progress
    curriculum/                 course/module/lesson authoring, quiz authoring
    knowledge/                   knowledge base: upload, list, render, trust levels
    chat/                         AI assistant UI + conversation history
    chart-lab/                     exercise upload + review
    audit-log/                      audit log viewer
  student/
    login/                    student login (separate session, deliberately not under (app)/)
    (app)/                     gated student surface — route group, no URL segment of its own
      page.tsx                  dashboard: level/XP, achievements, lesson list
      lessons/[lessonId]/         lesson content + quiz
      journal/                     trade log + AI insights
      ai-tutor/                     student-scoped AI chat
      chart-lab/                    "what do you see?" + Socratic follow-up
  api/
    chat/route.ts              admin chat POST endpoint
    student/chat/route.ts       student chat POST endpoint (student-isolated)
prisma/
  schema.prisma            full data model (see PROJECT_STATE.md for entity summary)
  seed.ts                   demo data (admin user, 5 students, sample curriculum, sample docs)
  test-db.ts                 shared test-database URL constant (vitest only, never dev.db)
scripts/
  extract-standalone-repo.sh  rebuilds this repo from the parent monorepo's trading_school/
                               subtree — see PROJECT_STATE.md "Repo extraction" if you're
                               reading this from inside the monorepo, not this standalone repo
```

## Environment variables

See `.env.example`. Key ones:

- `SESSION_SECRET` — signs session cookies; regenerate for anything beyond local dev
  (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `ANTHROPIC_API_KEY` — optional; enables the real AI provider instead of the mock one
- `ADMIN_EMAIL` / `ADMIN_SEED_PASSWORD` / `STUDENT_SEED_PASSWORD` — only read by `prisma/seed.ts`

## CI

`.github/workflows/ci.yml` runs lint, `tsc --noEmit`, and the test suite on every push/PR to
`main` — see that file's own header comment for why it lives inside this repo rather than a
parent monorepo's `.github/`.
