---
title: Curriculum System — Versioning, Prerequisites, Concepts
doc_type: reference
status: built
updated: 2026-08-10
tags: [doc/reference, doc/curriculum, status/built]
---

# CURRICULUM_SYSTEM — Trading X

Status: mostly built. Versioning, prerequisites (soft), and lightweight concept tagging are real
— see [`DATABASE.md`](DATABASE.md) §2.2 and `app/admin/curriculum/` for the admin authoring UI, verified
end-to-end in-browser (create → review → publish → edit-creates-new-version-without-disturbing-
the-published-one). Adaptive sequencing and concept mastery tracking remain spec-only (Phase 2/9).
No real curriculum *content* exists anywhere on the machine to migrate — confirmed by filesystem
search (repo, Desktop, Documents, Downloads) during the methodology-extraction work in
[`PROJECT_STATE.md`](PROJECT_STATE.md), and re-confirmed by this session's search for "Trading X"/"Skool" branding (no
hits outside unrelated EA Box docs) — the system is real, the content in it is still placeholder.

## Why this needs its own doc

`Module`/`ModuleProgress` (current schema) is enough for a flat, no-prerequisites, no-versioning
curriculum — fine for the seeded demo content, not fine for a real product where lessons get
edited after students have already progressed through them, and where "should this student see
lesson 12 yet" depends on more than "did they finish lesson 11."

## Content structure

`Course` → `Module` → `Lesson`, with `Lesson` as the versioned unit (see [`DATABASE.md`](DATABASE.md) §2.2).
Lessons support multiple content types (text, images, diagrams, video, audio, interactive charts,
examples, case studies, quizzes, exercises, downloadable resources, AI discussion) — the schema
should store content as typed blocks, not a single markdown blob, once content beyond
text/markdown actually exists to justify it. Today's markdown-only `Document`/rendering pipeline
stays as-is for the knowledge base; lesson content is a separate concern that can reuse the same
markdown renderer (`marked`, already in use) as its first content type.

## Versioning: DRAFT → REVIEW → PUBLISHED → ARCHIVED

Per brief §29. A `Lesson` has a `status` and a `version` number; editing a published lesson creates
a new version rather than mutating the published one in place. Students in progress against version
N keep referencing version N's content and any AI citations tied to it (see
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md)'s "content versioning and AI knowledge" section) until they explicitly
re-engage with the lesson, at which point they see the current published version. This prevents
the failure mode brief §29 is guarding against: an admin fixing a typo silently invalidating a
week's worth of already-completed student progress records or AI conversation history.

Each `Lesson` stores: id, version, status, created/published/updated timestamps, author,
prerequisites (see below), learning objectives, assessment criteria, related concepts.

## Prerequisites

A `Lesson` (or `Module`) declares prerequisite `Lesson`/`Concept` IDs. Enforcement is soft at
first (the platform recommends the prerequisite path, doesn't hard-block navigation) — hard
gating is a Phase 2+ product decision once there's real curriculum to test the UX against, not a
day-one requirement. Example from the brief: a student should understand candles before advanced
market structure — this is exactly the kind of ordering constraint the prerequisite graph
expresses, but whether skipping ahead is blocked or just discouraged-with-a-warning is a UX call
deferred until there's real content and real students to observe.

## Concept graph (lightweight, Phase 2 — full graph is Phase 9)

Brief §50 describes a rich concept graph ("liquidity connects to market structure, sweeps,
inducement, targets, sessions, entries, risk"). Building that as a real graph structure before
there's enough tagged content to populate it is premature. Phase 2's version: `Concept` is a flat,
admin-editable list (name, description); Lessons/Quizzes/ChartExercises each tag which Concepts
they teach or test via a join table. This is already enough to answer "what concepts has this
student been exposed to" and "what concepts does this quiz question test" — the two things
`ConceptMastery` tracking actually needs. Concept-to-concept *relationships* (the graph edges)
get added in Phase 9 once there's enough real data for edges to mean something, per [`ROADMAP.md`](ROADMAP.md).

## Concept mastery states

Per brief §7, tracked per student per concept:

```
NOT_INTRODUCED → INTRODUCED → LEARNING → UNDERSTOOD → APPLIED → CONSISTENT → MASTERED
```

State transitions are driven by evidence (quiz results, chart-exercise results, simulator
decisions tagged to that concept) evaluated by deterministic rules, not AI judgment (see
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md)'s determinism boundary) — e.g. "3 consecutive correct chart-exercise answers
tagged to this concept" is a rule a test can verify; "the AI feels the student understands this
now" is not. Confidence decays when evidence is old — a `lastEvidenceAt` timestamp plus a
scheduled/on-read decay check, exact decay curve to be tuned once there's real usage data rather
than guessed at now.

## Adaptive sequencing (Phase 9, not Phase 2)

Brief §7's full loop (student struggles → system provides alternate explanation → counterexamples
→ exercises → retest → track improvement) requires the concept graph, mastery tracking, and a
meaningful bank of alternate explanations/examples per concept to already exist. This is placed in
Phase 9 ([`ROADMAP.md`](ROADMAP.md)) deliberately — building adaptive branching logic against a curriculum that
doesn't exist yet would be designing in a vacuum.

## Admin authoring — DONE

`/admin/curriculum` (`app/admin/curriculum/`) lists modules grouped under their course, each
lesson expandable to show status, allowed next transitions (computed from
`allowedNextLessonStatuses()`, so the UI can never offer an invalid move), a content editor that
creates a new version on save, and a per-module "new lesson" form. Same review-before-publish
discipline as `/admin/knowledge`'s `needsReview` workflow, applied to `Lesson.status` instead.

One UI note for future browser-based testing in this environment: the lesson rows are native
`<details>`/`<summary>` elements, collapsed by default. The `computer` tool's coordinate-based
clicks were unreliable against buttons inside a just-expanded `<details>` panel (silently no-op'd
more than once during verification) — falling back to a JS-dispatched `.click()` on the actual
DOM button (already the documented workaround in [`PROJECT_STATE.md`](PROJECT_STATE.md) for this tool's known
click flakiness) worked every time and is the reliable way to test this page.
