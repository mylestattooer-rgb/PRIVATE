---
title: Project State — WORKING / MOCKED / NOT IMPLEMENTED
doc_type: source-of-truth
status: living
updated: 2026-08-14
tags: [doc/state, status/living]
---

# PROJECT_STATE — Trading School OS

**RESUMED 2026-08-14** — the admin explicitly resumed real build work after a full audit session (see
`vault/60-Agent-Runs/` or this session's transcript), scoped to routine engineering completions only:
closing gaps this doc already named, nothing requiring the admin's own trading/curriculum knowledge or
an external-account decision (git remote, hosting provider, Postgres instance — those were surfaced
back to the admin rather than decided unilaterally, per the standing autonomy grant's own boundary).
Prior state, for history: **PAUSED 2026-08-12** (chief-architect mandate pause-all directive, see
repo-root `feedback_chief_architect_mandate` memory); 2026-08-13 saw one narrowly-scoped exception
(Chart Lab's entitlement gate) without lifting the pause.

Last updated: 2026-08-14 — full Phase 0-5 audit (verified live in-browser against real seed data, not
from docs alone — see "Audit findings" below), then closed both real gaps the audit surfaced in
Chart Lab: (1) the Server Actions/DB-write test-coverage gap (new integration-test DB, `prisma/test.db`,
wired through `vitest.global-setup.ts` — see "Test infrastructure" below), including a real bug found
along the way (`submitChartAnswer` used `findUniqueOrThrow` on a student-suppliable ID — same footgun
already fixed once in the AI Tutor route on 2026-08-11 — now `findFirst`, browser- and test-verified);
(2) the admin create-form concept-tagging UI (`createChartExercise()` already accepted `conceptIds`,
only the checkboxes were missing) — built, browser-verified end-to-end with a real submission. Also
fixed a one-off flaky test (`auth.test.ts` timing out on a cold full-suite run; isolated re-runs were
always ~1s — bumped `testTimeout` to 15000ms as cheap insurance for CI's always-cold runs, not a logic
fix, since none was needed). Full suite: 60/60 passing (up from 51), `tsc --noEmit` and `eslint` both
clean. Prior entry, 2026-08-13: entitlement gate added to Chart Lab, both un-entitled and entitled
states browser-verified, stale docs corrected. Prior entry, 2026-08-12: Phase 0 discovery through
Phase 4 as that session scoped each phase — auth/entitlements, curriculum+quizzes+XP+levels+
achievements+mastery, trading journal, and knowledge trust levels + a student-facing AI Tutor — all
built and verified; see below and [`ROADMAP.md`](ROADMAP.md). Phase 5 (Chart Lab) was built, wired end-to-end, and
browser-verified too).

## Repo extraction (2026-08-14)

`trading_school/` has never had its own git remote — it's a folder inside the shared XAUUSD monorepo,
which also holds Meridian-7's live strategy parameters, real backtest P&L, and account numbers (see
"Methodology extraction" above for why that specific material is treated as protected IP). Standing
up CI for real meant deciding how to handle that, since GitHub Actions' `actions/checkout` pulls the
entire repository a workflow lives in — the old path-filtered workflow at the monorepo root would
have triggered only on `trading_school/**` changes, but still required the *whole* monorepo to live in
whatever remote it ran against.

**Decision (admin's explicit choice, not a routine call): extract `trading_school/` into its own
standalone repo via `git subtree split`, rather than push the whole monorepo.** This rewrites
`trading_school/`'s own commit history onto a new branch with paths flattened to repo-root, containing
only files that were always under `trading_school/` — Meridian-7/quant_platform/Gate/EA Box code and
research never becomes part of any object reachable from that branch, so it can never end up in
whatever remote that branch gets pushed to, private or otherwise. The current working directory is
unaffected — `trading_school/` keeps living at `C:\Users\Lenovo\XAUUSD\trading_school`, developed
exactly as before (same dev server, same `launch.json`, same everything); `git subtree push
--prefix=trading_school <remote> main` is the repeatable command for syncing future changes to the
standalone remote once one exists. `.github/workflows/ci.yml` was moved from the monorepo root into
`trading_school/` itself (dropping the `paths`/`working-directory` scoping it needed there, since the
extracted repo's root **is** the app root) so it travels correctly with the split.

**Done, 2026-08-14**: ran the split (`trading_school-standalone` branch, 15 commits, 115 files, tree
verified to contain zero paths outside what was always under `trading_school/`, `.env` confirmed never
committed anywhere in the history). Found — and fixed — a real gap in the "paths never leak" reasoning
above: **subtree split rewrites trees and parents, but never touches commit message text.** Two commits
in the original monorepo history bundled a `trading_school/` change together with unrelated same-day
work in one commit (normal practice for this monorepo, not a mistake at the time) — their *messages*
named the other project and described specific research parameters, even though their *file diffs*,
scoped to `trading_school/`, were completely clean (one changed only `PROJECT_STATE.md`'s pause banner,
the other was the initial Next.js scaffold). Reworded both with `git filter-branch --msg-filter`
(working tree stashed first since filter-branch needs it clean, popped back immediately after — nothing
in the monorepo's tracked or untracked state was lost). Re-verified clean after: no denylisted terms in
any commit message, same 115 files, same `.env` result.

**Reusable for next time**: `trading_school/scripts/extract-standalone-repo.sh` re-runs the split and
scans every resulting commit message against a denylist of known-sensitive terms — it reports and
blocks (does not push, does not auto-fix) if it finds a hit, since keyword matching can catch known
patterns but can't guarantee it catches everything; a human/agent should still read the log before
pushing. Re-running the script now would regenerate from `main`'s original (still-unscrubbed) history
and correctly get caught by its own denylist scan — the two commits above were fixed only on the
`trading_school-standalone` branch, not on `main`, since `main`'s own history is shared with every other
project in the monorepo and isn't this session's place to rewrite.

**Pushed, 2026-08-14**: the admin created an empty private GitHub repo (`mylestattooer-rgb/PRIVATE`) and
`trading_school-standalone` is now live at its `main` branch. A fine-grained PAT was needed for the
push — GCM (the configured `credential.helper`) hung indefinitely trying to open an interactive
OAuth prompt this environment can't display, so a token (scoped to just that one repo, Contents +
Workflows permissions — GitHub separately gates pushes that touch `.github/workflows/*`) was used
for a single push instead. The admin was advised to revoke it once the push was confirmed landed,
since it had already done its job. A local remote named `trading-school-standalone` (URL only, no
credentials stored) was added for future syncs: run
`trading_school/scripts/extract-standalone-repo.sh`, then `git push trading-school-standalone
trading_school-standalone:main`. The `.github/workflows/ci.yml` this repo carries will now actually
run on every push to its `main`, for the first time since Phase 1 first stubbed it out inert.

## Test infrastructure (new, 2026-08-14)

Domain functions that touch a real Prisma Client (as opposed to the pure functions
`app/lib/domains/*/[a-z]+.test.ts` already covered) now have a real integration-test path:
`prisma/test.db`, entirely separate from `prisma/dev.db`, schema-synced by `vitest.global-setup.ts`
before the suite runs. The sync is skipped when `prisma/test.db` is already newer than
`prisma/schema.prisma` (mtime check) — `prisma db push` is a ~50s cold CLI invocation on this machine,
which would otherwise tax every `npm test` run for no reason on an unchanged schema. First test file
using this pattern: `app/lib/domains/chartlab/exercises.test.ts` (9 tests: exercise creation with/
without concepts, answer submission including the bad-ID case, follow-up-reply student isolation, and
the `USE_CHART_LAB` entitlement check itself). Reusable by any other domain that needs the same —
`journal.ts` and `lessons.ts` are the next-most-obvious candidates, not done in this pass since neither
was the audit's named gap.

Read this before starting new work — it should let a fresh session pick up without
re-deriving context.

**Trading X long-term architecture**: this file stays the single source of truth for *current*
build status (the table right below). For the full 62-section product vision and its Phase 0-10
architecture reconciliation, see [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`DATABASE.md`](DATABASE.md),
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md), [`CURRICULUM_SYSTEM.md`](CURRICULUM_SYSTEM.md), and — most useful for "what's next" —
[`ROADMAP.md`](ROADMAP.md).

## What has been built (Phase 1)

All of the following were manually verified in a real browser session against the seeded
demo data (not just typechecked) — login, mutations, and navigation between pages all confirmed
live.

| Feature | Status | Notes |
|---|---|---|
| Admin login | **WORKING** | Custom signed-cookie session (`app/lib/auth.ts`), not NextAuth — see README |
| Student CRM (list/create/status) | **WORKING** | `app/admin/students/` |
| Student profiles (notes, curriculum progress) | **WORKING** | `app/admin/students/[id]/` |
| Knowledge base upload (file or paste) | **WORKING** | Markdown or plain text; `app/admin/knowledge/` |
| Markdown rendering | **WORKING** | via `marked`, styled with hand-written CSS (`.doc-render` in `globals.css`) — no Tailwind typography plugin installed |
| Knowledge retrieval | **WORKING** | Local TF-IDF cosine similarity, `app/lib/ai/retrieval.ts` — zero external calls |
| AI chat / answers | **MOCKED** by default | Real when `ANTHROPIC_API_KEY` is set (`app/lib/ai/provider.ts`); mock mode quotes retrieved chunks verbatim rather than reasoning over them — never invents methodology |
| Source citations on AI answers | **WORKING** | `Citation` rows link `Message` → `DocumentChunk`; UI shows source doc title + similarity score |
| Conversation history | **WORKING** | Persisted per `Conversation`/`Message`; sidebar in `/admin/chat` |
| Admin dashboard | **WORKING** | Live counts, recent activity feed |
| Audit log | **WORKING** | Every login, AI query/response, student/document mutation logged (`AuditLog` table) |
| Sample/placeholder labeling | **WORKING** | Seeded curriculum modules and knowledge docs are visibly marked "(sample)" / "SAMPLE" everywhere they appear — never presented as real methodology |
| Extracted-content review workflow | **WORKING** | `Document.needsReview` flag, distinct from `isSample` — see "Methodology extraction" section below |
| Student login + dashboard | **WORKING** | `/student/login`, gated `/student` dashboard; separate session cookie from admin ([`ARCHITECTURE.md`](ARCHITECTURE.md) "Auth: two principal types"); only ACTIVE demo students have login enabled, TRIAL/PAUSED/LEAD correctly rejected |
| Entitlements | **WORKING** | `app/lib/domains/entitlements/`, one capability (`USE_AI_TUTOR`) checked server-side and shown on the student dashboard |
| Automated tests | **WORKING (minimal)** | vitest, `npm test` — 60 tests: pure-function coverage across retrieval/auth/learning/assessment/progression/journal/chartlab, plus (new 2026-08-14) real Prisma-backed integration tests for Chart Lab's Server Action-facing domain functions — see "Test infrastructure" above |
| CI | **LIVE** | `.github/workflows/ci.yml`, now running against `mylestattooer-rgb/PRIVATE` on GitHub since the 2026-08-14 repo extraction (see "Repo extraction" below) — first time it's actually executed since being stubbed out inert in Phase 1 |
| Rate limiting | **WORKING** | `proxy.ts` — 10/min on `login`/`student/login`, 30/min on `api/chat`, per-IP; verified 429 after limit, page doesn't break |
| Curriculum versioning | **WORKING** | `Course`/`Lesson`/`LessonVersion`/`Concept`; `/admin/curriculum` authoring UI; verified full create→review→publish→edit-without-disturbing-published cycle in-browser |
| Quizzes | **WORKING (basic)** | `Question`/`QuestionAttempt`, deterministic grading; student quiz UI at `/student/lessons/[id]`, admin authoring at `/admin/curriculum`; verified correct (+XP, achievement) and incorrect (no XP, feedback shown) paths |
| XP / levels | **WORKING (basic)** | `XpEvent` append-only ledger, `Level.xpThreshold`; pure `totalXp()`/`levelForXp()`; shown on student dashboard with progress to next level |
| Achievements | **WORKING (one)** | `Achievement`/`UserAchievement`, unlocked server-side inside the grading transaction; `FIRST_QUIZ_PASSED` seeded and verified unlocking + displaying on dashboard |
| Concept mastery | **WORKING** | `ConceptMastery`, driven by `QuestionAttempt` evidence via pure `applyMasteryEvidence()`; verified NOT_INTRODUCED→LEARNING transition on a fresh correct answer, shown on student dashboard |
| Trading journal | **WORKING** | `/student/journal` — create/delete trades, deterministic stats (win rate, avg R, best/worst setup, top mistake); data isolation verified (a second student's journal correctly showed empty) |
| Journal AI insights | **WORKING (deterministic)** | `AiInsight`, evidence-linked to the trades it summarizes; gated at 5 trades minimum (never manufactures a conclusion from too little data); text is template-based today, not yet routed through `app/lib/ai/provider.ts` — see [`DATABASE.md`](DATABASE.md) §2.4 |
| Knowledge trust levels | **WORKING** | `Document.trustLevel` (A_OFFICIAL/B_INSTRUCTOR_APPROVED/C_REFERENCE/D_COMMUNITY), admin-settable at `/admin/knowledge`; both AI providers and citation UI factor it in |
| Student AI Tutor | **WORKING** | `/student/ai-tutor`, entitlement-gated, own Route Handler with student-scoped conversation isolation; verified real Q&A, cross-student isolation, and a rejected hijack attempt |
| Chart Lab | **WORKING** | `/admin/chart-lab` (upload chart + task) and `/student/chart-lab` (answer "what do you see?" → one AI Socratic follow-up → student reply); `ChartExercise`/`ChartAnswer` models + migration `20260811185640_add_chart_lab`; image stored as a `data:` URL directly in SQLite (no external blob storage needed — the "needs image-upload infrastructure" blocker this doc previously listed doesn't apply, the feature was designed around not needing any). `socraticFollowUp()` in `app/lib/ai/provider.ts` calls `pickSocraticQuestion()` (`app/lib/domains/chartlab/socratic.ts`, deterministic question bank) in mock mode or a real Anthropic call (system-prompted to ask, never grade or reveal) when `ANTHROPIC_API_KEY` is set — not dead code, genuinely wired from student action → domain function → provider. Student answers/follow-ups scoped by `studentId` on both read and write. Seeded with 1 sample exercise (placeholder SVG chart) in `prisma/seed.ts`. 4 unit tests for the pure `pickSocraticQuestion` selection logic pass (`socratic.test.ts`); full suite is 51/51 passing; `npx tsc --noEmit` is clean. **Manually verified live in-browser 2026-08-12**: logged in as admin, viewed the seeded exercise on `/admin/chart-lab` with its uploaded image and answer count rendering correctly; logged in as student `ava.whitfield@example.com` on `/student/chart-lab` and confirmed a full real round trip already existed in the DB — her "what do you see" answer, the AI's mock-mode Socratic follow-up question, and her reply to it, all rendering correctly on reload. Confirms the Server Action → domain function → provider → DB write chain genuinely works end-to-end, not just typechecks. **Committed** 2026-08-12 (`41105fc`, `fa77c07`) — `app/admin/chart-lab/`, `app/lib/domains/chartlab/`, `app/student/(app)/chart-lab/`, the migration, `schema.prisma`, both `layout.tsx` nav files, `provider.ts`, and `seed.ts` are all tracked. **Entitlement gate added and browser-verified 2026-08-13**: new `USE_CHART_LAB` capability (`app/lib/domains/entitlements/capabilities.ts`), gated exactly like `USE_AI_TUTOR` — page-level upsell ("Chart Lab isn't on your current plan yet.") in `app/student/(app)/chart-lab/page.tsx` plus a defense-in-depth `studentCan()` check inside both Server Actions in `app/student/(app)/chart-lab/actions.ts` (silent no-op on rejection, matching that file's existing invalid-input convention rather than the API-route 403 pattern, since Server Actions have no response-status channel here). Granted on the seeded `free` plan alongside `USE_AI_TUTOR`; the nav item stays visible either way (same as AI Tutor), only the page content and mutations are gated. Verified live in-browser: an un-entitled student (`free` plan capabilities temporarily set to just `USE_AI_TUTOR`) saw the upsell block and nothing else; the same student, re-granted `USE_CHART_LAB`, could still browse an exercise; a second student (`marcus.odei@example.com`, entitled) completed a fresh full round trip — submitted an answer, got a real Socratic follow-up, submitted a reply, all persisted correctly on reload — confirming the gate didn't disturb the existing Server Action → domain function → provider → DB write chain. **Real gaps, still not closed**: (1) no automated test coverage for the Server Actions/DB writes/upload validation or the new entitlement check, only the pure question-picker (`socratic.test.ts`) — matches the fact that `USE_AI_TUTOR`'s gate has no test coverage either, so no new test infra was invented for this pass; (2) the admin create form has no concept-tagging UI — `createChartExercise()` accepts `conceptIds` but nothing in `app/admin/chart-lab/page.tsx` lets the admin set them, so `Concept`-tagged assessment (the brief's stated Chart Lab scope) isn't reachable yet; (3) in real (non-mock) `ANTHROPIC_API_KEY` mode, `socraticFollowUp()` sends only the exercise prompt text and the student's typed response to Claude — never the chart image itself, so even "real" mode is language-only, not actually looking at the chart — still an open, undecided product/scope question, not resolved by this pass; (4) no student-level-tuned scaffolding — [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md)'s TEACHER→COACH→QUESTIONER→REVIEWER posture shift by `Level` isn't wired in, question selection is purely `priorAnswerCount % bank.length`. [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md) §2.3, and [`DATABASE.md`](DATABASE.md) §2.3 already correctly described this as DONE (they were already accurate, not stale, when checked 2026-08-13); [`ROADMAP.md`](ROADMAP.md) had one stale line ("Still entirely uncommitted") that has now been corrected. |

### Still out of scope (schema exists for some, no UI yet)

Marked **NOT YET IMPLEMENTED** — nav shows them as "Coming soon" stubs so the intended full
platform shape is visible without pretending they work. (Trading journal, quizzing, the
student-facing AI Tutor, and Chart Lab, formerly listed here, are now built — see the table
above.)

- **Lead/sales CRM workflows** — `CrmActivity` model exists, only written to by student
  status changes so far; no dedicated lead pipeline UI, no automated follow-ups
- **Automations** (inactivity detection, automated emails, escalation to human) — `Approval`
  model exists for the human-approval gate this would need, but nothing produces approval
  requests yet
- **Analytics** (school-wide performance, common-question mining) — no aggregation beyond
  the dashboard's raw counts

## Long-term vision: "Trading X Student App" (2026-08-09)

The admin's stated end goal is for this platform to eventually replace Skool as the entire
student-facing product, not just sit alongside it as an internal CRM/knowledge tool. Features
named for that future student app:

- Lessons
- Progression levels
- Trading simulator
- Chart quizzes
- Trade journal
- AI tutor trained on the school's methodology
- Upload chart → AI asks the student what they see
- Challenges
- Achievements
- Community
- Prop-firm preparation

None of this is scoped or scheduled yet — recorded here so it isn't lost, not as a commitment to
build in this order. Cross-reference against what Phase 1 already has or has scaffolded:

- **AI tutor** — the existing `/admin/chat` AI assistant (retrieval + citations, see above) is
  the admin-facing precursor to this; a student-facing version would need its own auth/UI surface
  and likely a stricter prompt (answer only from approved, non-`needsReview` content).
- **Trade journal** — `JournalTrade` model already exists in `prisma/schema.prisma`, unused (see
  Outstanding task #5). "Upload chart → AI asks what you see" is a materially different feature
  (image input, Socratic-style prompting) from journal logging/analysis — don't conflate the two
  when scoping.
- **Lessons / progression levels** — overlaps with the existing `Module`/`ModuleProgress` models,
  which currently model simple curriculum + per-student status/score, not gamified levels.
- **Trading simulator, chart quizzes, challenges, achievements, community, prop-firm prep** — no
  existing schema or scaffolding for any of these; all net-new.

## Content pipeline (proposed, 2026-08-11 — not started)

Separate from the student-app vision above: an automated pipeline (Obsidian vault → Claude
script generation → HeyGen digital-twin video render → human approval → publish) for lesson
videos, market breakdowns, and social content. Full audit, HeyGen API research, and proposed
architecture in [`HEYGEN_CONTENT_PIPELINE.md`](HEYGEN_CONTENT_PIPELINE.md) — conditional GO,
pending a free-tier quality check before any spend or code. Reuses the existing
`AiProvider`/`AnthropicProvider` pattern from `app/lib/ai/provider.ts` and the currently-unused
`Approval` Prisma model; needs new async job-tracking infra (nothing to reuse there).

## Key architectural decisions

1. **Custom auth, not NextAuth.** `next-auth@beta` (Auth.js v5) against Next.js 16 (very
   recently released) was a compatibility gamble not worth taking for a single-admin,
   credentials-only tool. `app/lib/auth.ts` is ~70 lines: `jose`-signed JWT in an httpOnly
   cookie, verified in `requireAdmin()` (Server Components/Pages, redirects) and
   `requireAdminApi()` (Route Handlers, returns null → caller sends 401).
2. **Prisma pinned to 6.x, not the newly-released 7.x.** v7 makes driver adapters mandatory
   even for local SQLite (`new PrismaClient()` throws without one) — unnecessary complexity
   for a single-file dev database. v6 needs zero adapter, uses the classic
   `url = env("DATABASE_URL")` pattern. Documented in `prisma/schema.prisma`'s header comment.
3. **Server Actions for CRUD, one Route Handler for chat.** Students/notes/progress/knowledge
   upload/login all use React Server Actions (`"use server"` files) — less boilerplate, and
   Next's own guidance says every Server Function must re-check auth itself (done via
   `requireAdmin()` at the top of each). Chat uses `app/api/chat/route.ts` instead because the
   client needs incremental message-list state that a form-action round-trip doesn't fit as
   naturally.
4. **AI provider is an interface, not a hardcoded call.** `getAiProvider()` in
   `app/lib/ai/provider.ts` returns `MockProvider` (default) or `AnthropicProvider` (if
   `ANTHROPIC_API_KEY` is set) — both implement the same `AiProvider` interface, so adding a
   third provider (OpenAI, etc.) is a new class + one branch in `getAiProvider()`, no call-site
   changes.
5. **Retrieval is real, generation is what's mocked.** The TF-IDF search in
   `app/lib/ai/retrieval.ts` runs against the actual `DocumentChunk` table with no external
   dependency — it's not a stub. Only the *answer generation* step falls back to a template
   when no AI provider is configured, and the UI/README are explicit about which is which.
6. **Everything sample/seeded is visibly labeled.** `Document.isSample` and module titles
   suffixed "(sample)" ensure a school-real deployment can tell placeholder content from real
   uploads at a glance — this was a hard requirement (don't invent or imply confirmed
   methodology).

## Methodology extraction (2026-08-09)

The admin asked to "upload my methodology." No standalone teaching document existed anywhere on
the machine (checked repo `.md` files, Desktop, Documents, Downloads) — what exists instead is the
admin's own trading-system research: `PROJECT_NOTES.md`, `RESEARCH_LOG.md`, and
`quant_platform/KNOWLEDGE_BASE.md` in the repo root/`quant_platform/`, one directory up from this
project.

**Important finding, confirmed with the admin before proceeding:** those files describe specific,
live/validated proprietary trading strategies (exact tuned parameters, real backtest P&L, account
numbers) — not curriculum. `PROJECT_NOTES.md` explicitly notes the live strategy was deliberately
renamed to keep its mechanics unguessable "while IP protection is pending." Putting that level of
detail in front of students would risk exposing IP the admin is actively protecting.

**Resolution (admin's explicit choice):** extract only the generic, teachable *concepts and
process discipline* — position sizing formulas, adaptive risk sizing as a category, confluence
filter design, overfitting/backtesting red flags, liquidity-sweep-as-a-signal-concept,
session-context awareness, regime-aware design — with every specific strategy name, tuned
parameter, and backtest result stripped. Six documents were written this way and imported via
`prisma/import-drafts.ts` (source markdown in `prisma/draft-docs/`, one-off script, not part of
the app's runtime):

1. Risk Management — Adaptive Position Sizing & Guardrails
2. Signal Confluence — Why Multiple Filters Beat a Single Signal
3. Backtesting Discipline — Avoiding Self-Deception
4. Liquidity Sweeps & Session Context
5. Regime-Aware Strategy Design
6. Research Discipline — How We Evaluate Whether Something Actually Works

**New schema field to support this: `Document.needsReview` (Boolean, default false).** Distinct
from `isSample` (= fake demo content) — `needsReview` means "real content, extracted/adapted from
another source, not yet confirmed accurate or appropriate by an admin." Surfaced everywhere
`isSample` is: list/detail page badges, AI chat citation badges, the mock provider's answer text,
and the Anthropic system prompt (told to flag it as provisional). An **Approve** action
(`app/admin/knowledge/actions.ts` → `approveDocument`) flips it to `false`; tested live and
confirmed the badge disappears everywhere (list, detail, and new chat citations) once approved.
The admin has approved 1 of the 6 as of this writing (Risk Management); the other 5 are still
pending their review — see Outstanding tasks.

**Known cosmetic gap:** approving a document does not strip the "DRAFT:" prefix from its title —
left as-is deliberately (renaming is a one-line edit the admin can make from the document page
whenever they're ready, didn't want to auto-rename without asking).

## Current database schema (see `prisma/schema.prisma` for the authoritative source)

- **AdminUser** — email/passwordHash/name/role; owns Notes, AuditLog entries, Approvals
- **Student** — CRM record (status: LEAD/TRIAL/ACTIVE/PAUSED/CHURNED, source, timestamps) **and**
  login-capable account (nullable passwordHash/authEnabledAt, planId → Plan); owns Notes,
  ModuleProgress, Conversations, JournalTrades, CrmActivities, QuestionAttempts, XpEvents,
  UserAchievements, ConceptMasteries, AiInsights
- **Plan** — entitlements: name + comma-separated capabilities string; one `free` plan seeded
- **Course** / **Module** / **Lesson** / **LessonVersion** — versioned curriculum content;
  `Lesson.status` (DRAFT/REVIEW/PUBLISHED/ARCHIVED), `currentVersionId` only repoints on publish
- **Concept** — flat, admin-editable, implicit m2m with `Lesson`/`Question` (what they teach/test)
- **Question** / **QuestionAttempt** — quiz questions (JSON-encoded choices, deterministic
  `correctIndex`) + per-student graded attempts
- **Level** / **XpEvent** / **Achievement** / **UserAchievement** — progression: XP is a summed
  append-only ledger, level is an XP-threshold lookup, achievements unlock server-side only
- **ConceptMastery** — per-student per-concept state (NOT_INTRODUCED→...→MASTERED), driven by
  `QuestionAttempt` evidence via a pure streak-based state machine
- **ModuleProgress** — per-student progress against a `Module` (status + optional score)
- **Note** — free-text CRM notes on a student, optional author, optional pinned flag
- **CrmActivity** — lightweight activity log distinct from AuditLog (student-facing CRM
  history vs. system-wide admin audit trail)
- **Document** / **DocumentChunk** — knowledge base source + its retrieval chunks;
  `isSample` flag (fake demo content), `needsReview` flag (real but unconfirmed — see
  "Methodology extraction" above), `trustLevel` (A_OFFICIAL/B_INSTRUCTOR_APPROVED/C_REFERENCE/
  D_COMMUNITY, admin-set), `status` (PROCESSING/READY/ERROR)
- **Conversation** / **Message** / **Citation** — AI chat history (both `/admin/chat` and
  `/student/ai-tutor` now real); `Citation` is the join linking an assistant `Message` to the
  `DocumentChunk`(s) it cited, with a similarity score
- **JournalTrade** — student-owned trade log, writable from `/student/journal`
- **AiInsight** — evidence-linked pattern observations over a student's own `JournalTrade`s,
  m2m to the trades it summarizes; kept structurally separate from `JournalTrade.notes`
- **AuditLog** — system-wide action log (every login, AI query/response, student/doc mutation)
- **Approval** — human-approval gate for sensitive AI-proposed actions; schema exists, nothing
  writes to it yet since no automation feature produces approval requests in Phase 1

## `flash/` — an unrelated tool in this repo (2026-09-18)

**WORKING, and not part of the trading school app.** `flash/` is a self-contained tattoo flash
catalogue: it has no dependencies, no framework, and imports nothing from `app/`. It is here
only because this is the repo that was to hand. It can be lifted into its own repo with a
single `git init`.

- `node flash/build.mjs` generates `sheets.html` (the printable book — 177 A4 pages, 2,118
  designs, 12 a page at 60mm, artwork only), `index.html` (browsable catalogue) and
  `test-sheet.html` (true-size print test with a 100mm ruler).
- `flash/designs.json` is a ledger, not a cache: a design keeps its reference number forever,
  and deleting artwork retires that reference rather than recycling it.
- ~23MB of artwork is committed under `flash/designs/`. The generated `sheets.html` and
  `test-sheet.html` are gitignored — they rebuild on demand and are ~19MB.

See [`flash/README.md`](flash/README.md) for use, and the 2026-09-18 entry in
[`SESSION_LOG.md`](SESSION_LOG.md) for what was rejected while building it.

## Known issues / rough edges

- Retrieval always returns up to 3 sources per query even when only one is truly relevant —
  with a small knowledge base, shared boilerplate words (e.g. "placeholder", "methodology")
  across sample docs give weak-but-nonzero cosine similarity to unrelated docs. Not wrong, just
  noisy; a similarity-score floor (e.g. drop anything below ~0.1) would tighten this once there's
  a larger, more realistic knowledge base to tune against.
- `app/api/chat/route.ts` does not stream — answers return in one shot. Fine for the mock
  provider; worth revisiting if real Anthropic answers start feeling slow.
- Browser-automation clicks (`computer` tool) intermittently didn't register during manual
  testing in this environment (coordinate/compositing issue, not an app bug) — JS-dispatched
  events were used as a fallback and confirmed every flow works. Recurred during Phase 1
  student-auth testing (2026-08-10): a click that had actually succeeded server-side (student
  record created) appeared not to on the immediately-following page-text read; a fresh navigate
  showed the correct state. Treat a `get_page_text` right after a `computer` click as possibly
  stale — re-navigate or re-read before concluding an action failed. Recurred again, differently,
  during curriculum-versioning testing the same day: `computer` clicks on buttons inside a native
  `<details>` panel silently no-op'd (not a stale-read issue this time — the DB genuinely never
  changed), while a JS-dispatched `.click()` on the real DOM button worked every time. When a
  `computer` click against this app produces no effect at all (not just a stale read), fall back
  to `javascript_tool` clicking the actual element before concluding the app is broken.
- **Real bug found and fixed 2026-08-10**: `redirect()` from `next/navigation` doesn't propagate
  when called inside an awaited cross-module helper in this Next.js 16.3.0 + Turbopack setup —
  affected the pre-existing admin auth too, not just new code. Full writeup in [`SECURITY.md`](SECURITY.md)
  "Known Next.js 16 redirect quirk". Only caught by in-browser verification; a unit test with a
  mocked `redirect()` would have (and initially did) hidden it.
- **Turbopack stale route cache produced a false 404** (2026-08-11): a brand-new route
  (`/student/journal`) 404'd on first load even though the file existed at the correct path and
  compiled without error in the server log. `rm -rf .next` + restarting the dev server fixed it
  immediately. Not the first time a stale `.next/dev` cache has caused a misleading symptom in
  this environment this session — if a route/behavior looks wrong right after adding new files or
  killing a dev server abruptly, clear `.next` and restart before spending time debugging the
  application code.
- **Dev server process died unexpectedly mid-session** (2026-08-11, during Phase 4 verification):
  `preview_list` returned empty and `fetch()` calls started failing with "Failed to fetch" (i.e.
  connection refused, not an app error) with no corresponding crash logged anywhere accessible.
  Restarting via `preview_start` recovered immediately, cookies/DB state intact (SQLite file
  persists independent of the dev server process). If a previously-working preview suddenly can't
  be reached at all, check `preview_list` for an empty result before assuming an app bug.
- **Real bug found and fixed 2026-08-11**: the student chat route used `findUniqueOrThrow` for a
  student-scoped conversation lookup — isolation itself was correct (a mismatched ID matched
  nothing), but the unhandled throw on that miss produced a raw 500 with a server-side stack trace
  instead of a clean 404. Fixed via `findFirst` + explicit not-found response. Full writeup in
  [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) "Student-facing AI Tutor." Caught by deliberately trying to hijack another
  student's conversation via a raw `fetch()`, not by normal-path testing — worth doing for any new
  student-scoped endpoint, not just the happy path.

## Outstanding tasks (recommended order)

1. **Real methodology ingestion — partially done, needs finishing.** 6 concept-level documents
   extracted from internal research notes are live under `needsReview` (see "Methodology
   extraction" above); 1 approved so far, 5 awaiting review at `/admin/knowledge`. These cover
   *process discipline* (risk sizing, backtesting rigor, confluence design) — they do NOT cover
   the ICT/SMC vocabulary the 3 seeded SAMPLE docs stand in for (market structure, FVG, volume
   profile), which still need real replacement content from the admin directly, since that
   wasn't derivable from the research notes at all.
2. **Retrieval quality**: add a similarity floor (see Known issues above) once real content
   exists to tune against.
3. **Lead/sales CRM workflows** — `CrmActivity`/`Student.status`/`Student.source` are already
   modeled.
4. Consider whether Next.js 16 / React 19 stay pinned as-is or get revisited once they're
   more battle-tested — flagging only because both were bleeding-edge at scaffold time, and
   this session found real behavioral quirks in this version (see Known issues above).
5. **Randomized question pools** ([`DATABASE.md`](DATABASE.md) §2.3, brief §53) — no anti-cheating yet; fine with
   one-to-two questions per lesson, a real gap once lessons have enough questions for order to
   matter.
6. **Wire `AiInsight` to the real `AiProvider`** ([`DATABASE.md`](DATABASE.md) §2.4) — currently deterministic
   template text; swapping in real phrasing is additive, not urgent while mock-mode is the
   default provider anyway.
7. **Chart Lab — core loop, entitlement gate, test coverage, and concept tagging all closed out. One
   real gap left, deliberately.** The feature (chart exercises, upload, Socratic AI follow-up) is
   built, wired end-to-end, browser-verified, committed, entitlement-gated, and now test-covered — the
   admin upload → student answer → follow-up → reply flow was confirmed live 2026-08-12, a second full
   round trip plus both entitlement states 2026-08-13, and both the concept-tagging UI and a real
   integration-test suite 2026-08-14. (a) **DONE 2026-08-13**: `USE_CHART_LAB` capability gate,
   page-level upsell + Server Action defense in depth, consistent with the AI Tutor's existing pattern.
   (b) **DONE 2026-08-14**: concept-tagging checkboxes on the admin create form
   (`app/admin/chart-lab/page.tsx`), wired to the `conceptIds` the domain function already accepted;
   browser-verified with a real submission that persisted and rendered the tag. (c) **left open, not
   decided here** — whether the real-provider path should send the chart image to Claude (currently
   text-only, blind to the actual chart) is a real product/scope call, not a routine one, consistent
   with the standing autonomy grant's own carve-out for calls like this.

## Next recommended task

Two things, both cheap, both directly continuing task #2:

1. **Admin reviews the 5 pending `needsReview` documents** at `/admin/knowledge` and clicks
   Approve on each once satisfied they're accurate/appropriate — no code required.
2. **Admin provides real market-structure/curriculum content** (the ICT/SMC vocabulary — market
   structure, FVG, volume profile, premium/discount, etc.) to replace the 3 SAMPLE docs, since
   none of that existed in the research notes to extract from. This is the one piece that
   genuinely can't be derived from anything already on the machine — it has to come from the
   admin.
