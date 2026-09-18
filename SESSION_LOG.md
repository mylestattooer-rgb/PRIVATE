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

## 2026-09-18 — Flash catalogue and printable flash book (`flash/`)

**Unrelated to the trading school app.** `flash/` is a self-contained tool for a tattoo
business that happens to live in this repo: no dependencies, no framework, touches nothing in
`app/`. It can be lifted out with a single `git init` if it ever should be.

Takes 2,118 SVG designs and produces a printable flash book (`sheets.html` → 177 A4 pages, 12
designs a page at 60mm, artwork only) and a browsable catalogue (`index.html`). Built and
tuned against real test prints — the user printed pages and reported back, which drove every
sizing decision.

**Rejected, with reasons — do not retry these:**

- **Thumbnail hashing to find duplicate artwork.** Rendered all designs at 48px and hashed
  each tile. Reported "0 visual duplicates", which was false: tested against a pair known to
  be byte-identical, the tiles hashed *differently*, because subpixel positioning changes the
  antialiasing. The method cannot detect duplicates at all. Comparing shape geometry plus
  viewBox works and found 4 true duplicate pairs.
- **One CSS grid flowing across printed pages.** Rows break wherever they land and the drift
  accumulates: successive pages started 14.4mm, 16.3mm then 18.1mm down, and once drift passed
  a row height a page silently held 9 designs instead of 12 — 193 pages instead of 177. Chunk
  into one grid per page with an explicit `break-after`.
- **`aspect-ratio: 1` alone to keep a plate square.** A grid item will not shrink below its
  content's intrinsic size, so a tall design stretches its own plate. Needs
  `min-width: 0; min-height: 0` on the artwork.
- **Inverting artwork for dark mode.** Reads as a photographic negative and misrepresents how
  black ink sits on skin. Designs are always black on white, in both themes.
- **Sizing a print grid to exactly the printable height.** Sub-pixel rounding tips the last row
  onto the next page. Leave ~2mm of slack.

**Learned:**

- **Placeholder art hides layout bugs.** Square samples concealed both the plate-stretching bug
  and an empty-artboard bug. Neither appeared until real artwork with varied aspect ratios
  arrived.
- **Assert each replacement in an edit script, not just that the file changed.** A caption
  removal silently did not match; the overall-change assert passed, and the book went to 353
  pages with half-empty sheets before anyone noticed.
- **Printing an A3-sized PDF on A4 paper scales it to ~71%.** This was mistaken for a layout
  fault twice. `test-sheet.html` exists because of it: a true A4 page showing designs at their
  real printed size, with a printed 100mm ruler to catch a printer applying "fit to page".
- **Measure the artefact, not the intent.** Every size claim here was verified by extracting
  geometry from the generated PDF with PyMuPDF rather than trusting the CSS.

**Outstanding:** 2,077 of 2,118 designs still carry Illustrator's `Asset NNNN` filename (41
named and tagged). Irrelevant to the printed book, which has no captions, but it limits the
screen catalogue's search. Near-identical variants (several hannya daggers, two flaming
dragons) remain — different files, so removing them is an artwork judgement, not a comparison.

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
