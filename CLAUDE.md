@AGENTS.md

# Start here, every session

Read [`PROJECT_STATE.md`](PROJECT_STATE.md) before doing anything else. It is the single
source of truth for what is WORKING / MOCKED / NOT YET IMPLEMENTED. Where any other document
disagrees with it, it wins. [`DOCS_INDEX.md`](DOCS_INDEX.md) maps every other doc.

[`SESSION_LOG.md`](SESSION_LOG.md) is the running memory of this project — what previous
sessions did, decided, and learned. Read the most recent entries to pick up where the last
session stopped.

## Load what you need, not everything

This file is loaded into **every** session, so it stays short on purpose. The documents below
are *referenced, not imported* — read one when the task touches it, not by default. That is
what keeps context cheap.

| Working on | Read |
|---|---|
| Anything at all | [`PROJECT_STATE.md`](PROJECT_STATE.md) |
| Routing, auth, server actions | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Provider, retrieval, citations | [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) |
| Schema, models, migrations | [`DATABASE.md`](DATABASE.md) |
| Auth rules, threat model | [`SECURITY.md`](SECURITY.md) |
| Lessons, versioning, quizzes | [`CURRICULUM_SYSTEM.md`](CURRICULUM_SYSTEM.md) |
| Product direction | [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) |
| What to build next | [`ROADMAP.md`](ROADMAP.md) |

## Before you finish, write down what you learned

This project's memory is these files. Nothing is remembered automatically — if a session ends
without updating them, that work is forgotten. So before ending any session that changed
something:

1. **Append an entry to [`SESSION_LOG.md`](SESSION_LOG.md)** — date, what changed, why, and
   anything the next session would otherwise have to rediscover. Newest entry at the top.
2. **Update [`PROJECT_STATE.md`](PROJECT_STATE.md)** if the WORKING / MOCKED / NOT YET
   IMPLEMENTED picture moved.
3. **Update the affected reference doc** if behaviour changed. A doc that now describes
   something untrue is worse than no doc.
4. **Commit it with the code.** Memory that isn't committed doesn't survive the session, the
   machine, or a laptop change.

Record what was *rejected* and why, not just what was done. A future session that doesn't know
why an approach was abandoned will try it again.

## Protected IP — a hard boundary

This repository was split out of the private `XAUUSD` monorepo with `git subtree split`
specifically so that Meridian-7's live strategy parameters, real backtest P&L and account
numbers could never be reachable from this remote.

`PROJECT_NOTES.md`, `RESEARCH_LOG.md`, `quant_platform/KNOWLEDGE_BASE.md`, `AGENT_CONSTITUTION.md`,
`AGENT_RD_SYSTEM_PROPOSAL.md` and `agents/` live one directory up and are **deliberately not
here**. Never copy their contents into this repo, quote tuned parameters or backtest results
into these docs, or commit anything derived from them. Teachable *concepts* stripped of
specifics are fine — that precedent is set in `PROJECT_STATE.md` "Methodology extraction".

## House rules

- This is Next.js 16 and it differs from training data — the `@AGENTS.md` rules above are not
  optional. Check `node_modules/next/dist/docs/` before writing framework code.
- No automated trade execution exists or is planned. This is an educational tool.
- Anything sample or seeded must stay visibly labelled as such.
- Don't hand-edit `AGENTS.md`; `next dev` regenerates it.
