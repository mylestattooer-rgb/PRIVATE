# PROJECT_STATE — Trading School OS

Last updated: 2026-08-09 (Phase 1 MVP built + first real methodology extraction pass, both
verified end-to-end in-browser).

Read this before starting new work — it should let a fresh session pick up without
re-deriving context.

## What has been built (Phase 1)

All of the following were manually verified in a real browser session against the seeded
demo data (not just typechecked) — login, mutations, and navigation between pages all confirmed
live.

| Feature | Status | Notes |
|---|---|---|
| Admin login | **WORKING** | Custom signed-cookie session (`app/lib/auth.ts`), not NextAuth — see README |
| Student CRM (list/create/status) | **WORKING** | `app/admin/students/` |
| Student profiles (notes, curriculum progress) | **WORKING** | `app/admin/students/[id]/` |
| Knowledge base upload (file or paste) | **WORKING** | Markdown or plain text; `app/admin/knowledge/` |
| Markdown rendering | **WORKING** | via `marked`, styled with hand-written CSS (`.doc-render` in `globals.css`) — no Tailwind typography plugin installed |
| Knowledge retrieval | **WORKING** | Local TF-IDF cosine similarity, `app/lib/ai/retrieval.ts` — zero external calls |
| AI chat / answers | **MOCKED** by default | Real when `ANTHROPIC_API_KEY` is set (`app/lib/ai/provider.ts`); mock mode quotes retrieved chunks verbatim rather than reasoning over them — never invents methodology |
| Source citations on AI answers | **WORKING** | `Citation` rows link `Message` → `DocumentChunk`; UI shows source doc title + similarity score |
| Conversation history | **WORKING** | Persisted per `Conversation`/`Message`; sidebar in `/admin/chat` |
| Admin dashboard | **WORKING** | Live counts, recent activity feed |
| Audit log | **WORKING** | Every login, AI query/response, student/document mutation logged (`AuditLog` table) |
| Sample/placeholder labeling | **WORKING** | Seeded curriculum modules and knowledge docs are visibly marked "(sample)" / "SAMPLE" everywhere they appear — never presented as real methodology |
| Extracted-content review workflow | **WORKING** | `Document.needsReview` flag, distinct from `isSample` — see "Methodology extraction" section below |

### Explicitly out of scope for Phase 1 (schema exists, no UI yet)

Marked **NOT YET IMPLEMENTED** — nav shows them as "Coming soon" stubs so the intended full
platform shape is visible without pretending they work:

- **Lead/sales CRM workflows** — `CrmActivity` model exists, only written to by student
  status changes so far; no dedicated lead pipeline UI, no automated follow-ups
- **Trading journal analysis** — `JournalTrade` model exists in the schema, unused; no
  ingestion, no pattern/mistake analysis
- **Quizzing / weak-area detection** — no model, no UI
- **Automations** (inactivity detection, automated emails, escalation to human) — `Approval`
  model exists for the human-approval gate this would need, but nothing produces approval
  requests yet
- **Analytics** (school-wide performance, common-question mining) — no aggregation beyond
  the dashboard's raw counts

## Key architectural decisions

1. **Custom auth, not NextAuth.** `next-auth@beta` (Auth.js v5) against Next.js 16 (very
   recently released) was a compatibility gamble not worth taking for a single-admin,
   credentials-only tool. `app/lib/auth.ts` is ~70 lines: `jose`-signed JWT in an httpOnly
   cookie, verified in `requireAdmin()` (Server Components/Pages, redirects) and
   `requireAdminApi()` (Route Handlers, returns null → caller sends 401).
2. **Prisma pinned to 6.x, not the newly-released 7.x.** v7 makes driver adapters mandatory
   even for local SQLite (`new PrismaClient()` throws without one) — unnecessary complexity
   for a single-file dev database. v6 needs zero adapter, uses the classic
   `url = env("DATABASE_URL")` pattern. Documented in `prisma/schema.prisma`'s header comment.
3. **Server Actions for CRUD, one Route Handler for chat.** Students/notes/progress/knowledge
   upload/login all use React Server Actions (`"use server"` files) — less boilerplate, and
   Next's own guidance says every Server Function must re-check auth itself (done via
   `requireAdmin()` at the top of each). Chat uses `app/api/chat/route.ts` instead because the
   client needs incremental message-list state that a form-action round-trip doesn't fit as
   naturally.
4. **AI provider is an interface, not a hardcoded call.** `getAiProvider()` in
   `app/lib/ai/provider.ts` returns `MockProvider` (default) or `AnthropicProvider` (if
   `ANTHROPIC_API_KEY` is set) — both implement the same `AiProvider` interface, so adding a
   third provider (OpenAI, etc.) is a new class + one branch in `getAiProvider()`, no call-site
   changes.
5. **Retrieval is real, generation is what's mocked.** The TF-IDF search in
   `app/lib/ai/retrieval.ts` runs against the actual `DocumentChunk` table with no external
   dependency — it's not a stub. Only the *answer generation* step falls back to a template
   when no AI provider is configured, and the UI/README are explicit about which is which.
6. **Everything sample/seeded is visibly labeled.** `Document.isSample` and module titles
   suffixed "(sample)" ensure a school-real deployment can tell placeholder content from real
   uploads at a glance — this was a hard requirement (don't invent or imply confirmed
   methodology).

## Methodology extraction (2026-08-09)

The admin asked to "upload my methodology." No standalone teaching document existed anywhere on
the machine (checked repo `.md` files, Desktop, Documents, Downloads) — what exists instead is the
admin's own trading-system research: `PROJECT_NOTES.md`, `RESEARCH_LOG.md`, and
`quant_platform/KNOWLEDGE_BASE.md` in the repo root/`quant_platform/`, one directory up from this
project.

**Important finding, confirmed with the admin before proceeding:** those files describe specific,
live/validated proprietary trading strategies (exact tuned parameters, real backtest P&L, account
numbers) — not curriculum. `PROJECT_NOTES.md` explicitly notes the live strategy was deliberately
renamed to keep its mechanics unguessable "while IP protection is pending." Putting that level of
detail in front of students would risk exposing IP the admin is actively protecting.

**Resolution (admin's explicit choice):** extract only the generic, teachable *concepts and
process discipline* — position sizing formulas, adaptive risk sizing as a category, confluence
filter design, overfitting/backtesting red flags, liquidity-sweep-as-a-signal-concept,
session-context awareness, regime-aware design — with every specific strategy name, tuned
parameter, and backtest result stripped. Six documents were written this way and imported via
`prisma/import-drafts.ts` (source markdown in `prisma/draft-docs/`, one-off script, not part of
the app's runtime):

1. Risk Management — Adaptive Position Sizing & Guardrails
2. Signal Confluence — Why Multiple Filters Beat a Single Signal
3. Backtesting Discipline — Avoiding Self-Deception
4. Liquidity Sweeps & Session Context
5. Regime-Aware Strategy Design
6. Research Discipline — How We Evaluate Whether Something Actually Works

**New schema field to support this: `Document.needsReview` (Boolean, default false).** Distinct
from `isSample` (= fake demo content) — `needsReview` means "real content, extracted/adapted from
another source, not yet confirmed accurate or appropriate by an admin." Surfaced everywhere
`isSample` is: list/detail page badges, AI chat citation badges, the mock provider's answer text,
and the Anthropic system prompt (told to flag it as provisional). An **Approve** action
(`app/admin/knowledge/actions.ts` → `approveDocument`) flips it to `false`; tested live and
confirmed the badge disappears everywhere (list, detail, and new chat citations) once approved.
The admin has approved 1 of the 6 as of this writing (Risk Management); the other 5 are still
pending their review — see Outstanding tasks.

**Known cosmetic gap:** approving a document does not strip the "DRAFT:" prefix from its title —
left as-is deliberately (renaming is a one-line edit the admin can make from the document page
whenever they're ready, didn't want to auto-rename without asking).

## Current database schema (see `prisma/schema.prisma` for the authoritative source)

- **AdminUser** — email/passwordHash/name/role; owns Notes, AuditLog entries, Approvals
- **Student** — CRM record (status: LEAD/TRIAL/ACTIVE/PAUSED/CHURNED, source, timestamps);
  owns Notes, ModuleProgress, Conversations, JournalTrades (unused), CrmActivities
- **Module** / **ModuleProgress** — curriculum + per-student progress (status + optional score)
- **Note** — free-text CRM notes on a student, optional author, optional pinned flag
- **CrmActivity** — lightweight activity log distinct from AuditLog (student-facing CRM
  history vs. system-wide admin audit trail)
- **Document** / **DocumentChunk** — knowledge base source + its retrieval chunks;
  `isSample` flag (fake demo content), `needsReview` flag (real but unconfirmed — see
  "Methodology extraction" above), `status` (PROCESSING/READY/ERROR)
- **Conversation** / **Message** / **Citation** — AI chat history; `Citation` is the join
  linking an assistant `Message` to the `DocumentChunk`(s) it cited, with a similarity score
- **JournalTrade** — schema ready for trading-journal analysis, not yet wired to any UI
- **AuditLog** — system-wide action log (every login, AI query/response, student/doc mutation)
- **Approval** — human-approval gate for sensitive AI-proposed actions; schema exists, nothing
  writes to it yet since no automation feature produces approval requests in Phase 1

## Known issues / rough edges

- Retrieval always returns up to 3 sources per query even when only one is truly relevant —
  with a small knowledge base, shared boilerplate words (e.g. "placeholder", "methodology")
  across sample docs give weak-but-nonzero cosine similarity to unrelated docs. Not wrong, just
  noisy; a similarity-score floor (e.g. drop anything below ~0.1) would tighten this once there's
  a larger, more realistic knowledge base to tune against.
- No automated test suite yet (see Outstanding tasks).
- `app/api/chat/route.ts` does not stream — answers return in one shot. Fine for the mock
  provider; worth revisiting if real Anthropic answers start feeling slow.
- Browser-automation clicks (`computer` tool) intermittently didn't register during manual
  testing in this environment (coordinate/compositing issue, not an app bug) — JS-dispatched
  events were used as a fallback and confirmed every flow works. Mentioning this only so a
  future session doesn't mistake it for a real bug if it recurs.

## Outstanding tasks (recommended order)

1. **Automated tests.** Nothing beyond `tsc --noEmit` + `eslint` + manual browser verification
   exists yet. Start with the AI retrieval scoring function (pure, easy to unit test) and the
   auth session round-trip.
2. **Real methodology ingestion — partially done, needs finishing.** 6 concept-level documents
   extracted from internal research notes are live under `needsReview` (see "Methodology
   extraction" above); 1 approved so far, 5 awaiting review at `/admin/knowledge`. These cover
   *process discipline* (risk sizing, backtesting rigor, confluence design) — they do NOT cover
   the ICT/SMC vocabulary the 3 seeded SAMPLE docs stand in for (market structure, FVG, volume
   profile), which still need real replacement content from the admin directly, since that
   wasn't derivable from the research notes at all.
3. **Retrieval quality**: add a similarity floor (see Known issues above) once real content
   exists to tune against.
4. **Lead/sales CRM workflows** — the next Phase-1-adjacent feature explicitly requested in
   the long-term vision; `CrmActivity`/`Student.status`/`Student.source` are already modeled.
5. **Trading journal ingestion + mistake-pattern analysis** — `JournalTrade` model is ready;
   needs an upload/entry UI and an analysis pass (likely another `AiProvider`-style pluggable
   piece rather than hardcoded logic).
6. Consider whether Next.js 16 / React 19 stay pinned as-is or get revisited once they're
   more battle-tested — flagging only because both were bleeding-edge at scaffold time.

## Next recommended task

Two things, both cheap, both directly continuing task #2:

1. **Admin reviews the 5 pending `needsReview` documents** at `/admin/knowledge` and clicks
   Approve on each once satisfied they're accurate/appropriate — no code required.
2. **Admin provides real market-structure/curriculum content** (the ICT/SMC vocabulary — market
   structure, FVG, volume profile, premium/discount, etc.) to replace the 3 SAMPLE docs, since
   none of that existed in the research notes to extract from. This is the one piece that
   genuinely can't be derived from anything already on the machine — it has to come from the
   admin.
