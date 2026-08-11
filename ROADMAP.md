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
| **Deployment pipeline** | **DONE (inert)** — `.github/workflows/trading-school-ci.yml` (lint+typecheck+test); repo has no git remote yet so it doesn't run anywhere, added as the ready-to-go extension point |
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

## Phase 2 — Assessment: FIRST SLICE DONE

| Item | Status |
|---|---|
| Concept mapping | **DONE** (Phase 1) — flat, admin-editable, tagged onto Lessons and Questions |
| Question bank + quizzes | **DONE (basic)** — `Question`/`QuestionAttempt`, deterministic grading (`app/lib/domains/assessment/questions.ts`), student-facing quiz UI at `/student/lessons/[id]`, admin authoring in `/admin/curriculum`. **Not built**: randomized question pools/anti-cheating (brief §53) |
| Progression levels / XP | **DONE (basic)** — `Level`/`XpEvent`, pure `totalXp()`/`levelForXp()` (`app/lib/domains/progression/`), shown on student dashboard. 4 levels seeded (0/50/150/300 XP). **Not built**: multi-condition level requirements (brief §5 wants lessons+quizzes+simulator combined — only quiz XP feeds it so far) |
| Achievements | **DONE (one)** — `Achievement`/`UserAchievement`, server-side-only unlock inside the grading transaction. One achievement (`FIRST_QUIZ_PASSED`) as proof of pattern |
| Challenges | **NOT STARTED** — needs more evidence sources (journal, simulator) to be meaningful |
| ConceptMastery | **NOT STARTED** — `DATABASE.md` §2.2; now has real evidence (QuestionAttempt) to drive it, this is the natural next piece |

Verified end-to-end in-browser: correct answer → +10 XP, level progress bar updates, achievement
unlocks and shows on dashboard; incorrect answer → 0 XP, no achievement, "not quite" feedback
with explanation; admin can add a question to a lesson and it appears correctly for students.
34 tests total now (up from 22) — `app/lib/domains/progression/` and `assessment/` both unit-tested
where the logic is pure (grading equality, XP summation, level lookup, achievement conditions).

**Next concrete milestone:**
1. `ConceptMastery` (`DATABASE.md` §2.2) — now that `QuestionAttempt` provides real evidence,
   this is buildable without designing in a vacuum.
2. Randomized question selection (brief §53) once a lesson has enough questions for it to matter.
3. A second achievement + a second level-contributing XP source, to prove the pattern generalizes
   before investing in the richer multi-condition Level rule engine the brief eventually wants.

## Phase 3 — Journal: NOT STARTED (schema partially exists)

`JournalTrade` schema exists, zero UI, zero writes (`PROJECT_STATE.md` Outstanding task #5).
Student journal UI + `AiInsight` table (`DATABASE.md` §2.4) + reflection workflow. Depends on
Phase 1's student auth (journal entries are student-owned, private by default).

## Phase 4 — AI Tutor (Trading X methodology): PARTIALLY DONE

Knowledge base, retrieval, tutor interface, and citations already exist and work
(`AI_ARCHITECTURE.md` "Current"). What's missing: trust levels (Level A-D), student-facing tutor
UI (today's `/admin/chat` is admin-only), AI security hardening for a student-facing surface
(`SECURITY.md` §2.1-2.2). Socratic questioning behavior is Phase 5's concern (tied to Chart Lab)
though the underlying provider infrastructure is shared.

## Phase 5 — Chart Lab: NOT STARTED

Chart exercises, annotations, upload analysis, Socratic AI questioning, concept assessment. Needs
Phase 2's concept tagging and Phase 4's trust-level/security work as prerequisites.

## Phase 6 — Simulator: NOT STARTED

Historical data engine, replay, orders, risk metrics, scenario training. The most infrastructure-
heavy phase (needs a real historical market-data source, per `ARCHITECTURE.md`'s note on keeping
`SimulatorSession` provider-agnostic) — do not start this before Phases 1-5 are stable, since it's
the single most expensive phase to build twice.

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
