# DATABASE — Trading X

Status: mixed. Section 1 describes the schema as it exists today (authoritative source:
`prisma/schema.prisma`) — this now includes student auth + entitlements (§2.1's plan), built as
Phase 1's first milestone in the same session this doc was first written. The rest of section 2
remains a planned evolution — **nothing else in section 2 is implemented yet**.

## 1. Current schema (implemented)

- **AdminUser** — email/passwordHash/name, role (ADMIN/STAFF).
- **Student** — CRM record (name/email/phone, status LEAD→TRIAL→ACTIVE→PAUSED→CHURNED, source,
  joinedAt/lastActiveAt) **and** login-capable account: nullable `passwordHash`/`authEnabledAt`
  (both null = CRM lead, no login provisioned yet — resolves the question originally left open
  below) plus `planId` → `Plan`. Owns Notes, ModuleProgress, Conversations, JournalTrades,
  CrmActivities.
- **Plan** — entitlements: `name` + comma-separated `capabilities` string (see
  `app/lib/domains/entitlements/`). One `free` plan seeded so far, granting `USE_AI_TUTOR`.
- **Module** / **ModuleProgress** — flat curriculum unit + per-student status/score. No
  versioning, no prerequisites, no content-type modeling beyond what's rendered as markdown.
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

### 2.2 Curriculum (Phase 2 — depends on nothing new beyond what exists)

- **Course** — groups Modules (today's flat `Module` list becomes children of a `Course`).
- **LessonVersion** — supersedes treating a `Module` as the atomic content unit; a `Module`
  contains ordered `Lesson`s, each `Lesson` has versioned content (DRAFT/REVIEW/PUBLISHED/
  ARCHIVED — see `CURRICULUM_SYSTEM.md`) so editing a lesson doesn't destroy history.
- **Concept** — the knowledge-graph unit (brief §50); Lessons/Quizzes/ChartExercises each declare
  which Concepts they teach or test. Deliberately simple at first (a tagged list, not a graph
  database) — see `ROADMAP.md` Phase 9 for when this becomes a real graph.
- **ConceptMastery** — per-student, per-concept state (NOT_INTRODUCED → ... → MASTERED per brief
  §7), with a `lastEvidenceAt` timestamp so confidence can decay when evidence is old.

### 2.3 Assessment (Phase 2)

- **Question** / **QuestionAttempt** — quiz question bank + per-student attempts, randomized
  selection from a pool (anti-cheating, brief §53).
- **ChartExercise** / **ChartAnswer** — a chart + task (mark structure, find a sweep, etc.) +
  student's submitted answer, references `Concept`s tested.

### 2.4 Journal intelligence (Phase 3)

- No new tables needed beyond making `JournalTrade` writable from a real UI. Add an `AiInsight`
  table (student-scoped, evidence-linked — each insight row references the `JournalTrade`(s) that
  produced it) so AI-generated pattern observations stay clearly separate from `JournalTrade.notes`
  (student's own words) — brief §14/§15's "AI must never overwrite student reflections" becomes a
  schema-level guarantee, not just a UI convention.

### 2.5 Progression / gamification (Phase 2-3)

- **Level** — admin-configurable (per brief §5: level names/requirements must be editable without
  code changes), references a set of requirement rules (JSON-encoded, evaluated by deterministic
  code per `AI_ARCHITECTURE.md`'s determinism boundary).
- **XpEvent** — append-only ledger (source type + amount + studentId + timestamp), not a mutable
  running total column — makes XP auditable and abuse-detectable (brief §19's anti-farming
  requirement needs to see the event history, not just a current total).
- **Challenge** / **ChallengeProgress**, **Achievement** / **UserAchievement** — achievements
  validated server-side only (brief §18), never a client-reported "I did this" flag.

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
