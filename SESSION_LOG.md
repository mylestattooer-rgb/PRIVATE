---
title: Session Log — Running Project Memory
doc_type: log
status: living
updated: 2026-09-18
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
