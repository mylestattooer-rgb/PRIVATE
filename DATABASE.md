# DATABASE — Trading X

Status: mixed, and this doc now spans several build sessions (2026-08-10 through 2026-08-11) —
Phase 1 (student auth, entitlements, curriculum versioning) and Phase 2's first slice (quizzes,
XP, levels, achievements) are all real. Section 1 describes the schema as it exists today
(authoritative source: `prisma/schema.prisma`). Section 2 is what's left of the original planned
evolution — each subsection now says DONE/partial/NOT YET IMPLEMENTED rather than being uniformly
aspirational.

## 1. Current schema (implemented)

- **AdminUser** — email/passwordHash/name, role (ADMIN/STAFF).
- **Student** — CRM record (name/email/phone, status LEAD→TRIAL→ACTIVE→PAUSED→CHURNED, source,
  joinedAt/lastActiveAt) **and** login-capable account: nullable `passwordHash`/`authEnabledAt`
  (both null = CRM lead, no login provisioned yet) plus `planId` → `Plan`. Owns Notes,
  ModuleProgress, Conversations, JournalTrades, CrmActivities, QuestionAttempts, XpEvents,
  UserAchievements.
- **Plan** — entitlements: `name` + comma-separated `capabilities` string (see
  `app/lib/domains/entitlements/`). One `free` plan seeded so far, granting `USE_AI_TUTOR`.
- **Course** / **Module** / **Lesson** / **LessonVersion** — versioned curriculum (§2.2 below has
  the full writeup). `Module` still carries `ModuleProgress` for coarse per-module status/score;
  `Lesson` is the newer, versioned, publishable unit within a module.
- **Concept** — flat, admin-editable tag list, implicit m2m with both `Lesson` and `Question`.
- **Question** / **QuestionAttempt** — quiz questions and per-student attempts (§2.3 below).
- **Level** / **XpEvent** / **Achievement** / **UserAchievement** — progression (§2.5 below).
- **Note** — free-text CRM notes on a student, optional author, optional pinned flag.
- **CrmActivity** — lightweight student-facing activity log, distinct from `AuditLog` (system-wide
  admin audit trail).
- **Document** / **DocumentChunk** — knowledge base source + TF-IDF retrieval chunks. Flags:
  `isSample` (fake demo content), `needsReview` (real content, not yet admin-confirmed), `status`
  (PROCESSING/READY/ERROR).
- **Conversation** / **Message** / **Citation** — AI chat history. `Conversation.scope` already
  distinguishes STUDENT vs ADMIN, but no student-facing UI reads it yet. `Citation` joins an
  assistant `Message` to the `DocumentChunk`(s) it cited, with a similarity score — this is the
  mechanism that makes AI answers traceable, already real.
- **JournalTrade** — symbol/direction/entry/exit/result/rMultiple/setupTag/mistakeTag/notes.
  Schema-complete, zero UI, zero writes.
- **AuditLog** — every login, AI query/response, student/document mutation. System-wide, immutable
  append log.
- **Approval** — human-approval gate for sensitive AI-proposed actions (e.g. "send this email").
  Schema exists; nothing produces approval requests yet since no automation feature exists.

## 2. Planned evolution (NOT YET IMPLEMENTED — spec only, except §2.1)

Ordered roughly by dependency, not by brief section number. Each addition should land in its own
migration, attached to the Phase (see `ROADMAP.md`) that actually needs it — this list is not a
single big migration to run now.

### 2.1 Student identity — DONE

Built as planned: `Student` absorbed auth fields directly (nullable `passwordHash`/
`authEnabledAt`, both null meaning "CRM lead, no login yet") rather than a separate
`StudentAccount` table — no case emerged during implementation needing the two represented
separately. `Plan`/`planId` also landed, seeded with one `free` plan. Migration:
`20260810103309_add_student_auth_and_plans`.

### 2.2 Curriculum — mostly DONE (versioning + concept tagging; mastery tracking still pending)

- **Course** — groups Modules. `Module.courseId` is nullable (ungrouped modules stay valid); the
  one seeded `Course` ("Foundations") has all 6 sample modules backfilled onto it.
- **Lesson** / **LessonVersion** — built as specced: `Lesson` is the atomic unit within a `Module`,
  `status` (DRAFT/REVIEW/PUBLISHED/ARCHIVED per `CURRICULUM_SYSTEM.md`), `currentVersionId` points
  at whichever `LessonVersion` students see (only repointed on publish, per the versioning
  guarantee). Editing creates a new `LessonVersion` and resets `status` to DRAFT without touching
  `currentVersionId` — verified in-browser: publishing a lesson then editing it left the published
  version intact for students while a new draft version accumulated. Soft `prerequisites`
  self-relation exists on `Lesson` (informational only, no enforcement yet, as specced).
  Logic lives in `app/lib/domains/learning/` (`status.ts` is a pure, unit-tested state machine;
  `lessons.ts` is the DB-touching half — deliberately has no `import "server-only"`, since it's
  also called from `prisma/seed.ts` which runs outside Next's bundler where that virtual module
  doesn't resolve; see the comment there).
- **Concept** — flat, admin-editable list as specced, implicit many-to-many with `Lesson` (a
  concept doesn't need extra join-row fields, so no explicit join table). 3 concepts seeded,
  tagged onto the 2 sample lessons.
- **ConceptMastery** — **still NOT YET IMPLEMENTED** (per-student, per-concept state,
  NOT_INTRODUCED → ... → MASTERED per brief §7) — this needs quiz/chart-exercise evidence sources
  that don't exist yet (Phase 2 assessment), so it's deferred until there's real evidence to drive
  it, not built as an empty shell now.

### 2.3 Assessment — partially DONE (basic quizzes; randomization/anti-cheating still pending)

- **Question** / **QuestionAttempt** — built: `Question.choices` is a JSON-encoded string array
  (freeform count, not fixed at 4), `correctIndex` is the deterministic answer key, tagged to
  `Concept`s. Grading (`app/lib/domains/assessment/questions.ts`'s `gradeAttempt()`) is plain index
  equality — never AI judgment, per `AI_ARCHITECTURE.md`'s determinism boundary. **Not yet built**:
  randomized question selection from a pool (anti-cheating, brief §53) — today a lesson's questions
  are always shown in full and in the same order; fine for the current single-question demo lesson,
  a real gap once a lesson has enough questions that order/subset matters.
- **ChartExercise** / **ChartAnswer** — **still NOT YET IMPLEMENTED** — a chart + task (mark
  structure, find a sweep, etc.) + student's submitted answer, references `Concept`s tested. Needs
  Chart Lab (Phase 5) infrastructure (image handling) that doesn't exist yet.

### 2.4 Journal intelligence (Phase 3)

- No new tables needed beyond making `JournalTrade` writable from a real UI. Add an `AiInsight`
  table (student-scoped, evidence-linked — each insight row references the `JournalTrade`(s) that
  produced it) so AI-generated pattern observations stay clearly separate from `JournalTrade.notes`
  (student's own words) — brief §14/§15's "AI must never overwrite student reflections" becomes a
  schema-level guarantee, not just a UI convention.

### 2.5 Progression / gamification — Level/XP/Achievement DONE, Challenge still pending

- **Level** — built, but simpler than originally planned: a single `xpThreshold: Int` (unique)
  rather than a JSON-encoded rule set. A student's level is whichever `Level` has the highest
  `xpThreshold <= their total XP` (`app/lib/domains/progression/level.ts`, pure and unit-tested).
  Admin-configurable per brief §5 (a new row is a data change, no code change) — the richer
  multi-condition rule engine the brief eventually wants (lessons completed + quiz scores +
  simulator performance combined) is deferred until there's more than one evidence source to
  combine; a single XP threshold is honestly all that's meaningful with only quizzes built so far.
- **XpEvent** — built exactly as specced: append-only ledger, `totalXp()` is a pure sum over the
  events (`app/lib/domains/progression/xp.ts`), never a mutable running total. Currently one source
  (`QUIZ_CORRECT`, 10 XP) — adding a new source is a constant, not a migration.
- **Achievement** / **UserAchievement** — built, validated server-side only inside the same
  transaction as grading (`gradeAttempt()`), never a client-reported flag. One achievement so far
  (`FIRST_QUIZ_PASSED`) as the proof of pattern — `app/lib/domains/progression/achievements.ts`
  holds the pure unlock-condition checkers, one function per achievement, so new achievements don't
  bloat a single mega-function.
- **Challenge** / **ChallengeProgress** — **still NOT YET IMPLEMENTED** — structured challenges
  (brief §17) need more evidence sources (journal, simulator) to be meaningful; deferred with
  Phase 3+.

### 2.6 Simulator (Phase 6)

- **SimulatorSession** / **SimulatorTrade** — deliberately separate from `JournalTrade` (brief
  §12/§14 keep manual, simulator, and future broker-imported trades as distinct provenance, even
  though they may later share a reporting view). Must support real historical market data later
  without an education-platform rewrite — achieved by keeping `SimulatorSession` reference an
  abstract `dataSourceId`/date-range rather than embedding a specific data provider's schema.

### 2.7 Prop-firm prep (Phase 7)

- **PropRuleProfile** — versioned, NOT hard-coded (brief §22 is explicit and repeated in the
  non-negotiables list): `source`, `effectiveDate`, `lastVerifiedDate` fields are mandatory, not
  optional, so the UI can distinguish current-verified rules from stale ones.

### 2.8 Community (Phase 8)

- **CommunityPost** / **Comment** / **Reaction**, plus a `trustLevel` marker inherited from the
  `Document` knowledge-trust design (see `AI_ARCHITECTURE.md`) so community content is never
  silently promotable to authoritative methodology.

### 2.9 Knowledge trust levels (Phase 4, alongside AI tutor work)

- Add `Document.trustLevel` enum (A_OFFICIAL / B_INSTRUCTOR_APPROVED / C_REFERENCE / D_COMMUNITY).
  Coexists with today's `isSample`/`needsReview` rather than replacing them — those two answer "is
  this fake/unconfirmed," `trustLevel` answers "whose authority is this, once confirmed." Full
  reasoning in `AI_ARCHITECTURE.md`.

## Data integrity rules that apply to every addition above

Foreign keys and `onDelete` behavior follow the existing pattern (`Cascade` for
strictly-owned child records like `Note`→`Student`; never cascade-delete anything that other
domains might reference, e.g. deleting a `Concept` should not silently delete `ConceptMastery`
history — soft-deactivate instead). Every migration goes through Prisma's migration system (never
a manual schema edit against a live database) and every destructive-shaped change (column removal,
type narrowing) gets a backup verification step per the root `vault/00-Home/RECOVERY.md` process
before running against anything beyond local dev.
