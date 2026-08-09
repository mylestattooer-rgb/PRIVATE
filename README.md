# Trading School OS

An AI-powered operating system for a day-trading education business: student CRM, a
knowledge base of the school's own methodology, an AI assistant that answers from that
knowledge base with source citations, and an admin dashboard with a full audit log.

This is **Phase 1** of a larger vision (see `PROJECT_STATE.md` for what's built vs. planned).
No automated trade execution exists or is planned — this is an educational/operational tool.

## Stack

- **Next.js 16** (App Router, TypeScript, Server Actions) + **Tailwind CSS v4**
- **Prisma 6** + **SQLite** (`prisma/dev.db`) — zero external infra to run locally
- **Custom session auth** (signed JWT cookie via `jose` + `bcryptjs`) — not NextAuth/Auth.js,
  see "Why not NextAuth" below
- **AI provider abstraction** (`app/lib/ai/provider.ts`): defaults to a local mock provider;
  set `ANTHROPIC_API_KEY` to enable real generative answers via the Anthropic Messages API
- **Retrieval** (`app/lib/ai/retrieval.ts`): local TF-IDF cosine similarity over uploaded
  knowledge-base chunks — no embeddings API, runs entirely in-process

## Quick start

```bash
cd trading_school
npm install
cp .env.example .env        # already done for you locally; regenerate SESSION_SECRET for real use
npx prisma migrate dev      # creates prisma/dev.db and applies schema + seed
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`.

**Demo admin login:** `admin@tradingschool.local` / `ChangeMe123!` (from `.env`'s
`ADMIN_EMAIL` / `ADMIN_SEED_PASSWORD`, applied by `prisma/seed.ts`).

To re-seed at any time: `npm run db:seed`. To inspect the database visually: `npm run db:studio`.

## What's WORKING vs MOCKED vs NOT YET IMPLEMENTED

See `PROJECT_STATE.md` for the full breakdown. Short version: everything you can click on in
Phase 1 is real (live database, real retrieval, real auth) — the only mocked piece is AI
*generation* (not retrieval) when `ANTHROPIC_API_KEY` is unset, and that's labeled in the UI
itself, not just in docs.

## Why not NextAuth

`create-next-app` scaffolded on Next.js 16, which is very new. `next-auth@beta` (Auth.js v5)
compatibility with Next 16 wasn't something to gamble on for a single-admin, credentials-only
internal tool, so auth is a small hand-rolled signed-cookie session instead
(`app/lib/auth.ts`, ~70 lines, using `jose` for JWT signing). Simpler, fewer moving parts,
nothing to upgrade later.

## Why Prisma 6, not 7

Prisma 7 (released very recently) makes driver adapters mandatory even for local SQLite —
unnecessary complexity for a single-file dev database. Pinned to the stable 6.x line instead.
See `prisma/schema.prisma` header comment.

## Project layout

```
app/
  lib/
    db.ts            Prisma client singleton
    auth.ts           session create/verify/destroy (custom, not NextAuth)
    audit.ts           audit log writer
    ai/
      provider.ts       AI provider interface + Mock/Anthropic implementations
      retrieval.ts       TF-IDF chunking + retrieval over the knowledge base
  login/                login page + server action
  admin/
    layout.tsx          session guard + nav shell
    page.tsx             dashboard
    students/             CRM: list, create, profile, notes, progress
    knowledge/             knowledge base: upload, list, render
    chat/                   AI assistant UI + conversation history
    audit-log/               audit log viewer
  api/chat/route.ts        chat POST endpoint (client-driven, not a Server Action —
                            needs incremental client state for the message list)
prisma/
  schema.prisma          full data model (see PROJECT_STATE.md for entity summary)
  seed.ts                 demo data (admin user, 5 students, sample curriculum, sample docs)
```

## Environment variables

See `.env.example`. Key ones:

- `SESSION_SECRET` — signs session cookies; regenerate for anything beyond local dev
  (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `ANTHROPIC_API_KEY` — optional; enables the real AI provider instead of the mock one
- `ADMIN_EMAIL` / `ADMIN_SEED_PASSWORD` — only read by `prisma/seed.ts`
