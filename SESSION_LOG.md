---
title: Session Log — Running Project Memory
doc_type: log
status: living
updated: 2026-09-19
tags: [doc/log, status/living]
---

# Session Log

Append-only memory of what each session did, decided and learned. **Newest entry at the top.**

This exists because nothing is remembered automatically. A session that ends without writing
here is a session the project forgets. Record what was *rejected* and why, not only what was
built — otherwise a future session re-tries the dead end.

Entries before 2026-09-18 were not logged in this format; that history lives in
[`PROJECT_STATE.md`](PROJECT_STATE.md), which remains the authoritative statement of current
state. This log is the narrative of how it got there.

---

## 2026-09-19 — Mastery history: an append-only ledger behind the snapshot

Work spanned 2026-09-16 to 2026-09-19 on `claude/awesome-galileo-t3bi8q` (PR #2), logged here on
completion because `SESSION_LOG.md` did not exist on this branch until `main` was merged in.

**The defect.** `gradeAttempt()`'s upsert overwrites `ConceptMastery.state`,
`consecutiveCorrect` and `lastEvidenceAt` on every graded answer. That is correct for "what does
this student know right now?" and destroys everything else: when a concept first clicked, how many
times a streak broke and rebuilt, how long `MASTERED` held before it slipped. None of it was
reconstructable afterwards. The snapshot answers whether they know it; the path answers how people
learn it and who is about to slip, and only the snapshot was being kept.

**The fix.** `ConceptMasteryEvent`, built to the shape `XpEvent` already established: record every
event, derive the total, never trust a mutable running value that can drift from its own history.
Written inside `gradeAttempt()`'s existing `$transaction`, alongside the attempt and the XP event —
a crash between them would otherwise leave a mastery state with no evidence explaining it, which is
the exact drift the ledger exists to prevent. Migration
`20260916120000_add_concept_mastery_event`. 81/81 tests (74 before).

### Decisions, including what was rejected

- **Rejected: one row per state change.** Tempting and smaller, but a correct answer at an already
  `MASTERED` concept is real evidence and moves the streak, and that row would never be written.
  Per-evidence is the lossless direction — `fromState != toState` recovers the transitions, and the
  reverse is not recoverable. Don't "optimise" this into transitions-only later.
- **Rejected: `ConceptMasteryTransition` as the name.** Used in early notes. It describes state
  changes, which is not what the table records. `ConceptMasteryEvent` matches both the contents and
  its `XpEvent` sibling.
- **`attemptId` nullable with `onDelete: SetNull`, not `Cascade`.** Nullable so a future non-quiz
  evidence source (Chart Lab, simulator) can write here without another migration; `SetNull`
  because deleting an attempt must never silently rewrite a student's mastery history.
- **Kept the streak rule where it was.** `applyMasteryEvidence()` is untouched and still the single
  source of truth; the new `masteryTransition()` only expresses the movement, and is unit-tested
  without a database.

### The `ci.yml` episode — worth reading before touching CI config

Three branches independently hit the `LayoutProps` typecheck failure this log's 2026-09-18 entry
describes. This branch diagnosed it, then **ported PR #1's `npx next typegen` step verbatim rather
than solving it a second way**, on the explicit reasoning that a duplicate fix would no-op once any
of them reached `main`.

PR #4 got there first. The branch went un-mergeable on a `ci.yml` conflict where **both sides added
the identical step with different comments**. Resolved in `main`'s favour — one step, one canonical
comment — so this branch now contributes nothing to `ci.yml`. That was the intended outcome
reached from the other direction, and it is the right general rule: **when a fix for a shared
problem already exists on another branch, port it rather than author a competing version.**

A stale claim came out of it too. `PROJECT_STATE.md` had been left describing the typegen fix as
"fixed here, ported from the simulator branch", which stopped being true the moment `main` took
ownership. Corrected rather than left standing — a doc that describes something untrue is worse
than no doc.

### Why this mattered enough to build

Strategic, not incidental: a longitudinal record joining what a trader *perceives* (Chart Lab
answers), *believes* (mastery), *does* (journal) and what *happens* is a dataset nobody can scrape,
and it compounds per student per month. Three of those four layers were already collected; mastery
was the one throwing its history away. Data has a start date and cannot be backfilled, which is why
this was worth doing before anything with a faster payoff.

**Still open, and the reason the PR is a draft:** whether per-evidence is the right granularity for
what the data is eventually for. That is a judgement about intended use, not a code question.

### A pre-existing test-isolation race, surfaced by this branch

The docs-only commit above failed CI on a test this branch did not write:
`questions.test.ts > gradeAttempt > awards XP...` with `expected undefined to be 'LEARNING'`. The
`ConceptMastery` row had vanished mid-test.

Cause: `chartlab/exercises.test.ts`'s `beforeAll` wiped
`concept.deleteMany({ where: { slug: { contains: "-test" } } })`. Its own comment described that as
scoped to `"chartlab-test-"` and warned that an unscoped wipe would be "a real race" — but
`"-test"` also matches `questions-test-concept-1`, and `ConceptMastery`/`ConceptMasteryEvent`
cascade from `Concept`. Vitest runs files in parallel workers, so chartlab's worker was deleting
questions' fixtures while they were in use. The comment was right; the code did not implement it.

Fixed by anchoring the filter to `"chartlab-test-"` and renaming that file's own concept slug to
`chartlab-test-liquidity-sweep` so it still cleans up after itself. An audit of every `deleteMany`
in the suite found this was the only over-broad scope; every other file already scopes to its own
prefix.

- **Latent for a month, and not a flake.** CI had never run the tests at all before 2026-09-18 (the
  entry below explains why), so this could not have been caught there. It surfaced now because
  adding `conceptMasteryEvent.deleteMany()` to questions' `beforeAll` shifted worker timing.
- **Verified by mechanism, not by absence.** Ten consecutive full-suite runs passed 81/81, which
  only shows the race did not fire. The actual proof was a throwaway script: with the old filter the
  mastery row was gone after the wipe, with the new filter it survived. **Prefer this for any
  timing bug — a green run proves nothing about a race.**

**Not done, deliberately:** no consent flow, no terms of service, and no lawful basis for
processing yet. The ledger makes the data *exist*; it does not make it *usable*. Collecting
behavioural data without that framing may make it unusable for exactly the purpose that justifies
it, and consent cannot be retrofitted onto an existing student base.

---

## 2026-09-18 — Obsidian vault, CI first ever green, memory system

**Made the repo readable as an Obsidian vault.** The repo root *is* the vault — deliberately no
exported or duplicated copy, because a copy drifts out of date the moment it is made. Added a
tracked `.obsidian/` config, converted 92 backticked doc references into real markdown links,
added YAML frontmatter to the ten project docs, and added [`DOCS_INDEX.md`](DOCS_INDEX.md) as
the front door.

- **Chose markdown links over `[[wikilinks]]`.** Wikilinks are more idiomatic in Obsidian but
  break GitHub rendering. ``[`FILE.md`](FILE.md)`` works in Obsidian, GitHub and plain editors.
  Don't "improve" these into wikilinks later — it would be a regression.
- **Did not touch `AGENTS.md`.** `next dev` regenerates it, so edits there reappear as a
  permanent uncommitted diff.

**Fixed CI, which had never once been green.** All three prior runs on `main` failed identically
at `npx tsc --noEmit`:

```
app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.
```

`LayoutProps<"/">` is a **global type Next 16 generates** into `.next/types/`, wired in via
`next-env.d.ts`. Neither is committed (both are build output), so on a clean runner the global
doesn't exist. It passes locally only because a previous `next dev` left the types on disk —
which is exactly why it went unnoticed for a month. Fix was one step in `ci.yml`:

```yaml
- run: npx next typegen
```

- **Knock-on worth remembering:** because `tsc` exited non-zero, the `npm run test` step after
  it was **skipped on every run** — the suite had never actually executed in CI. It was healthy
  all along: 14 files, 74 tests, all passing.
- **Verified from a genuinely clean state** (deleted `.next` and `next-env.d.ts` first) rather
  than trusting a local pass on leftover generated files. Do this for any typegen-related fix.

**Corrected a mistake I had made.** `DOCS_INDEX.md` initially claimed `PROJECT_NOTES.md`,
`RESEARCH_LOG.md`, `AGENT_CONSTITUTION.md` and `AGENT_RD_SYSTEM_PROPOSAL.md` "do not exist".
Wrong — they live one directory up in the `XAUUSD` monorepo, deliberately excluded per
`PROJECT_STATE.md` "Repo extraction". Calling them nonexistent risked implying they were lost
or safe to recreate.

**Built this memory system.** Rewrote [`CLAUDE.md`](CLAUDE.md) from a bare `@AGENTS.md` include
into a router that points every new session at `PROJECT_STATE.md` and this log, and created this
file.

- **Verified `CLAUDE.md` is safe to author.** `next dev` writes `CLAUDE.md` too, so this needed
  checking rather than assuming. Per `node_modules/next/dist/server/lib/generate-agent-files.js`,
  it returns `claudeMd: 'skipped'` whenever `AGENTS.md` exists and hosts the rules block — which
  it does. **Two preconditions keep this true: `AGENTS.md` must keep existing and keep hosting
  the marker block, and `CLAUDE.md` must never contain that marker itself.** If someone deletes
  `AGENTS.md`, `next dev` will start overwriting `CLAUDE.md` and this router will be destroyed.
- **Design decision — reference, don't import.** `CLAUDE.md` loads into every session, so it is
  kept short and links to the big docs rather than importing them. Importing everything would
  burn context on every trivial task. Resist growing this file.

**Context:** the admin moved from the old Lenovo laptop to a new machine. Flagged that the
`XAUUSD` monorepo has no git remote of its own, so the protected-IP notes it holds are **not**
backed up by this GitHub repo and needed manual carrying across.
