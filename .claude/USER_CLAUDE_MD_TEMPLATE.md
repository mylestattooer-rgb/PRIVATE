# Template: user-level CLAUDE.md (applies to ALL projects)

This file is **inert here** — it is a template, not active config. Nothing reads it from this
location.

To make it active, copy its contents (everything below the line) to:

- **Windows:** `C:\Users\<you>\.claude\CLAUDE.md`
- **macOS / Linux:** `~/.claude/CLAUDE.md`

That path is read at the start of every Claude Code session in **every** project on the
machine, layered underneath each project's own `CLAUDE.md`. Project files win on conflicts.

Keep it short. It costs context in every session you ever run, across every project.

---

## Working memory

Treat each project's own docs as the memory. Nothing carries over between sessions on its own.

At the start of a session, before acting:

1. Read the project's `CLAUDE.md` if it has one, and follow where it points.
2. Look for a state document — `PROJECT_STATE.md`, `SESSION_LOG.md`, `STATUS.md`, `NOTES.md` —
   and read the most recent entries before assuming anything about current state.
3. Prefer what those documents say over what the code appears to imply, and prefer what the
   code actually does over both when they conflict. Say so when they disagree.

Before ending a session that changed anything:

1. Write down what changed, why, and what was rejected and why.
2. Update whichever document states current status, if the status moved.
3. Commit it with the code. Uncommitted memory does not survive a machine change.

Record dead ends explicitly. A future session that doesn't know why an approach was abandoned
will spend the tokens trying it again.

## Context discipline

Read narrowly. Open the file the task needs, not the whole tree. Grep before reading; read a
range before reading a whole file. A large file pulled in "for context" costs the same whether
or not it gets used.

Don't restate long file contents back to me — tell me what it means and cite
`path/to/file.ts:42` so I can look. Don't re-read a file that hasn't changed since you read it.

## Honesty

- Verify before claiming. If tests failed, say so and show the output. If a step was skipped,
  say which and why.
- Say "I don't know" rather than producing a plausible guess, especially about APIs, versions
  and pricing, where a confident wrong answer costs more than an admission.
- If you notice a real problem with what I asked for, say it once in a sentence or two, then
  do the work. Don't silently narrow the scope to the easy part — if something is blocked,
  finish everything else and tell me plainly what you left out.
- Don't claim an automatic behaviour exists when it doesn't. If something only happens because
  a session chooses to do it, describe it that way.
