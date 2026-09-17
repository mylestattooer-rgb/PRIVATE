# ROADMAP — Trading X

Status: Phase 0 (discovery) output. This reconciles the master brief's Phase 0-10 sequence against
what's actually built, rather than re-numbering as if starting from zero. **Read this file first**
in any future session to find current status — it will go stale fast as phases progress; update it
in the same session as any milestone that changes phase status, per the root `CLAUDE.md` docs
policy.

## Phase 0 — Discovery: DONE (this session)

Inventory of existing system, architecture decisions, and this doc set (`PRODUCT_SPEC.md`,
`ARCHITECTURE.md`, `DATABASE.md`, `AI_ARCHITECTURE.md`, `SECURITY.md`, `CURRICULUM_SYSTEM.md`,
`ROADMAP.md`). No application code changed in this phase.

## Phase 1 — Foundation: DONE

The brief's Phase 1 list is: auth, profiles, database, admin foundations, courses, modules,
lessons, progress tracking, basic dashboard, testing, deployment pipeline.

| Item | Status |
|---|---|
| Database | **DONE** — Prisma schema, migrations, SQLite dev |
| Admin auth | **DONE** — signed-cookie JWT (fixed a real redirect bug along the way, see `SECURITY.md`) |
| Admin foundations | **DONE** — dashboard, students, knowledge, chat, audit log |
| Basic dashboard | **DONE** — admin-side; student side has a proof-of-pattern stub (`/student`) |
| Modules / progress tracking | **DONE**, but flat (no versioning/prerequisites — see `CURRICULUM_SYSTEM.md`) |
| **Student auth** | **DONE** — `/student/login`, separate session cookie, `Student.passwordHash`/`authEnabledAt` |
| **Entitlements** | **DONE** — `app/lib/domains/entitlements/`, one capability (`USE_AI_TUTOR`) wired end-to-end |
| **Testing** | **DONE (minimal)** — vitest, 14 tests (retrieval TF-IDF scoring, auth session round-trips), wired to `npm test` |
| **Deployment pipeline** | **DONE, LIVE** — `.github/workflows/ci.yml` (lint+typecheck+test) now runs against `mylestattooer-rgb/PRIVATE` on GitHub, extracted from the monorepo via `git subtree split` (see PROJECT_STATE.md "Repo extraction") on 2026-08-14 |
| Courses / lessons (versioned) | **DONE** — `Course`/`Lesson`/`LessonVersion`/`Concept`, `/admin/curriculum` authoring UI, verified in-browser |

**A real bug was found and fixed while building this** (not a pre-planned task): `redirect()`
called from a cross-module auth helper silently failed to redirect in this Next.js 16.3.0 +
Turbopack setup — caught only by in-browser verification, not by unit tests. Full writeup in
`SECURITY.md`. Worth flagging here because it affected the *existing* admin auth too, not just the
new student code — a previously-undiscovered gap in what "Phase 1 admin MVP, verified in-browser"
actually covered.

Rate limiting (`SECURITY.md` §2.2) and curriculum versioning both landed after this table was
first written — every brief-listed Phase 1 item is now DONE. `app/lib/domains/learning/` holds the
lesson-versioning logic (`status.ts` pure state machine, unit-tested; `lessons.ts` the DB half);
22 tests total now (up from 14).

Phase 1 is complete. Phase 2's first slice (quizzes, XP, levels, achievements) landed the same
day — see the Phase 2 section below for what's built and what's next.

## Phase 2 — Assessment: DONE (to the depth this session scoped it)

| Item | Status |
|---|---|
| Concept mapping | **DONE** (Phase 1) — flat, admin-editable, tagged onto Lessons and Questions |
| Question bank + quizzes | **DONE (basic)** — `Question`/`QuestionAttempt`, deterministic grading (`app/lib/domains/assessment/questions.ts`), student-facing quiz UI at `/student/lessons/[id]`, admin authoring in `/admin/curriculum`. **Not built**: randomized question pools/anti-cheating (brief §53) |
| Progression levels / XP | **DONE (basic)** — `Level`/`XpEvent`, pure `totalXp()`/`levelForXp()` (`app/lib/domains/progression/`), shown on student dashboard. 4 levels seeded (0/50/150/300 XP). **Not built**: multi-condition level requirements (brief §5 wants lessons+quizzes+simulator combined — only quiz XP feeds it so far) |
| Achievements | **DONE (one)** — `Achievement`/`UserAchievement`, server-side-only unlock inside the grading transaction. One achievement (`FIRST_QUIZ_PASSED`) as proof of pattern |
| ConceptMastery | **DONE** — `app/lib/domains/progression/mastery.ts` (pure, unit-tested), wired into `gradeAttempt()`'s transaction, shown on student dashboard. NOT_INTRODUCED→...→MASTERED driven by consecutive-correct streaks per concept |
| Challenges | **NOT STARTED** — needs more evidence sources (journal, simulator) to be meaningful; correctly deferred, not a gap in this phase |

Verified end-to-end in-browser: correct answer → +10 XP, level progress updates, achievement
unlocks, ConceptMastery advances to LEARNING and displays on dashboard; incorrect answer → 0 XP,
no achievement, streak resets, "not quite" feedback with explanation; admin can add a question to
a lesson and it appears correctly for students. 38 tests total now (up from 22 at the start of
Phase 2) — `app/lib/domains/progression/` and `assessment/` both unit-tested where the logic is
pure (grading equality, XP summation, level lookup, achievement conditions, mastery streaks).

**Next concrete milestone (starts Phase 3):**
1. Trading journal UI + writes — `JournalTrade` schema has existed since Phase 0 discovery,
   unused; see Phase 3 below.
2. Randomized question selection (brief §53) once a lesson has enough questions for it to matter —
   left for whenever real content volume makes it a real gap, not simulated with placeholder data.
3. A second achievement + a second level-contributing XP source, to prove the pattern generalizes
   before investing in the richer multi-condition Level rule engine the brief eventually wants.

## Phase 3 — Journal: DONE (to the depth this session scoped it)

`JournalTrade` writable from `/student/journal` (create/delete, student-data-isolated); deterministic
stats (win rate, avg R, best/worst setup tag, most common mistake — `app/lib/domains/journal/stats.ts`,
pure/unit-tested); `AiInsight` generation gated at `MIN_TRADES_FOR_INSIGHT = 5`, evidence-linked to
the exact trades it summarizes (`DATABASE.md` §2.4 has the full writeup, including why the insight
text is deterministic-template today rather than routed through the AI provider).

Verified end-to-end in-browser: seeded 6 sample trades + 1 generated insight for one student;
added a new trade and deleted one via the real UI, both round-tripped to the DB correctly; a
second student's journal correctly showed empty (0 trades), confirming data isolation.

**Not built (correctly deferred, not a gap)**: reflection *workflow* beyond free-text notes (no
prompted reflection questions yet), broker-imported trades (brief §14's third provenance —
manual/simulator/broker — only manual exists, simulator doesn't exist until Phase 6).

## Phase 4 — AI Tutor (Trading X methodology): DONE (to the depth this session scoped it)

| Item | Status |
|---|---|
| Knowledge base, retrieval, citations | **DONE** (Phase 0) |
| Trust levels (A-D) | **DONE** — `Document.trustLevel`, both providers factor it in, citation UI shows it, admin sets it from `/admin/knowledge` |
| Student-facing tutor UI | **DONE** — `/student/ai-tutor`, entitlement-gated, own Route Handler, own conversation scope |
| AI security hardening (`SECURITY.md` §2.1) | **DONE** — student chat isolated at the query layer; a real isolation-adjacent bug (500 instead of 404 on a mismatched conversation ID) found and fixed during verification |
| Socratic questioning | **DONE** — landed as part of Phase 5 (Chart Lab), see below |
| Uncertainty categories (FACT/OBSERVATION/INTERPRETATION/HYPOTHESIS/TRADING_X_RULE/UNKNOWN) | **NOT STARTED** — `AI_ARCHITECTURE.md`'s planned tagging scheme isn't wired into Chart Lab's Socratic responses yet |

Verified in-browser: student asked a real question, got a grounded answer with trust-level-labeled
citations; a second student's chat history was empty; a direct hijack attempt against another
student's conversation ID was cleanly rejected (404, no data returned) after the fix.

## Phase 5 — Chart Lab: DONE (core loop; to the depth this session scoped it)

| Item | Status |
|---|---|
| Chart exercises (admin upload + task) | **DONE** — `/admin/chart-lab`, `ChartExercise` model, image stored as a `data:` URL in SQLite (5MB cap, png/jpeg/webp only) — no external blob storage needed, so the image-upload-infrastructure blocker this doc previously flagged doesn't apply |
| Student "what do you see?" answer + AI Socratic follow-up | **DONE** — `/student/chart-lab`, `ChartAnswer` model; `socraticFollowUp()` (`app/lib/ai/provider.ts`) asks one targeted question, never grades or reveals the answer, mock (deterministic question bank, `app/lib/domains/chartlab/socratic.ts`) or real Anthropic call depending on `ANTHROPIC_API_KEY` |
| Concept assessment (tagging exercises to `Concept`s) | **DONE** (2026-08-14) — admin create form has concept checkboxes now, browser-verified with a real tagged exercise |
| Annotations / drawing on the chart | **NOT BUILT** — student response is free-text only, no chart-marking tool |
| AI actually seeing the chart image | **NOT BUILT** — even in real-provider mode, `socraticFollowUp()` sends only the prompt text and the student's typed response to Claude, never the image itself; the follow-up is grounded in what the student wrote, not independent chart analysis |
| Level-tuned scaffolding (TEACHER→COACH→QUESTIONER→REVIEWER) | **NOT BUILT** — question selection is `priorAnswerCount % bank.length`, not keyed to student `Level` |
| Entitlement gate | **DONE** (2026-08-13) — `USE_CHART_LAB` capability, gated the same way as `USE_AI_TUTOR`: page-level upsell + Server Action-level defense in depth, see `PROJECT_STATE.md` "Chart Lab" |

Verified in-browser 2026-08-12: admin view renders a seeded exercise with its uploaded image and
answer count; student view shows a prior real answer, the AI's follow-up question, and the
student's reply to it, all correctly persisted and rendered on reload. 4 unit tests for the pure
`pickSocraticQuestion` selector pass; full suite is 51/51. Committed 2026-08-12 (`41105fc`,
`fa77c07`); the entitlement gate above was added and browser-verified 2026-08-13. **2026-08-14**:
concept tagging closed out (table above), plus a real integration-test suite for the Server
Action-facing domain functions (`app/lib/domains/chartlab/exercises.test.ts`, 9 tests against a real
Prisma-backed test DB) — found and fixed a `findUniqueOrThrow`-on-untrusted-ID bug along the way
(same class as the AI Tutor route's 2026-08-11 fix). Full suite now 60/60 — see `PROJECT_STATE.md`
"Chart Lab" and "Test infrastructure" for detail. Only remaining gap: the AI seeing the actual chart
image, left open as a product decision.

## Phase 6 — Simulator: DETERMINISTIC CORE BUILT, not yet persisted or surfaced

Historical data engine, replay, orders, risk metrics, scenario training. The most infrastructure-
heavy phase (needs a real historical market-data source, per `ARCHITECTURE.md`'s note on keeping
`SimulatorSession` provider-agnostic) — deliberately not started until Phases 1-5 were stable,
since it's the single most expensive phase to build twice.

**Built 2026-09-16** — `app/lib/domains/simulator/`, the pure engine, 144 tests. Signal →
Risk Manager → Execution Adapter → Portfolio → Metrics, with `AI_ARCHITECTURE.md`'s "AI can only
produce a Signal" rule enforced in the type system (a `Signal` carries no quantity, so only
`risk.ts` can size anything). No-look-ahead is structural: a strategy sees a frozen slice of bars
`0..i` and orders execute at bar `i+1`'s open, with a test proving a strategy that tries to read
tomorrow's bar gets nothing. Includes a latching daily-loss halt that blocks entries but never
exits, a paper broker with slippage and commission, provider-agnostic `MarketDataSource`, an
example SMA-crossover strategy, and `npm run backtest` for a runnable report. Closed trades match
the journal domain's `StatTrade`, so win rate and average R come from the existing
`computeJournalStats` rather than a second implementation. Full detail in
`app/lib/domains/simulator/README.md`, including a candid list of what the fill model omits
(no margin, no partial fills, no spread/swap, one symbol per run).

**Not built**: `SimulatorSession`/`SimulatorTrade` persistence (`DATABASE.md` §2.6), any student
UI, a `USE_SIMULATOR` entitlement, a real historical data provider, and a portfolio-level runner
for multiple symbols. No live-broker adapter exists and none should land inside this app — see
`PRODUCT_SPEC.md`'s permanent non-goal and the README's "Going live" section.

## Phase 7 — Prop-firm preparation: NOT STARTED

Configurable rule profiles (`PropRuleProfile`, `DATABASE.md` §2.7), prop education content
(depends on Phase 2's curriculum system being real), evaluation simulator (depends on Phase 6).

## Phase 8 — Community: NOT STARTED

Posts, comments, moderation, study groups, instructor content. Deliberately late — brief's own
framing is that Trading X should not be built around signals/community-as-the-product; the
education/simulation/journal core should be solid first.

## Phase 9 — Intelligence: NOT STARTED

Adaptive curriculum (`CURRICULUM_SYSTEM.md`'s deferred adaptive-sequencing section), full concept
knowledge graph (edges, not just tags), weakness detection, Student Digital Twin, weekly AI coach
review, personalized recommendations. Explicitly requires Phases 1-5 to have accumulated real
student data to be evidence-based rather than speculative — building this against synthetic/seed
data would violate the brief's own "every conclusion must be evidence-backed" rule.

## Phase 10 — Commercial scale: NOT STARTED

Billing, subscriptions (beyond the entitlements *mechanism* built in Phase 1 — actual payment
provider integration), mobile client, scaling work (SQLite → Postgres per `ARCHITECTURE.md`),
advanced analytics, additional external integrations. Gated on there being a real product worth
scaling, not built speculatively ahead of that.

## Sequencing principle

Each phase above should individually go through the brief's own §61 loop before being called
done: implement → test → verify → commit → document. This roadmap doesn't authorize building
everything in one pass — it's a reference for what's next and why, revisited and updated as each
milestone actually lands.
