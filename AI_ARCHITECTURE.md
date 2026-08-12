# AI_ARCHITECTURE — Trading X

Status: Phase 0 (discovery) for everything under "Planned" below. The provider/retrieval/citation
pipeline described under "Current" is real and implemented — see `PROJECT_STATE.md` for verified
status.

## Current: provider abstraction + grounded retrieval (implemented)

- **`AiProvider` interface** (`app/lib/ai/provider.ts`) — `getAiProvider()` returns `MockProvider`
  (default) or `AnthropicProvider` (if `ANTHROPIC_API_KEY` is set). Adding a third provider is a
  new class + one branch, no call-site changes. This already satisfies brief §10's "never couple
  the entire product to one AI provider."
- **Retrieval** (`app/lib/ai/retrieval.ts`) — local TF-IDF cosine similarity over `DocumentChunk`
  rows, zero external dependency, not a stub.
- **Citations** — every assistant `Message` links to the `DocumentChunk`(s) it drew from via
  `Citation` (with a similarity score). The UI shows source doc title + score. This is the
  concrete implementation of brief §10's "every important methodology answer should be traceable
  back to approved Trading X material" — already true today, just not yet distinguishing *which
  tier* of material (see Trust Levels below).
- **Mock-mode honesty** — when no `ANTHROPIC_API_KEY` is set, the mock provider quotes retrieved
  chunks verbatim rather than reasoning over them, so it never invents methodology even in demo
  mode. This behavior is a feature, not a placeholder to remove later.
- **Sample/review labeling** — `Document.isSample` (fake demo content) and `Document.needsReview`
  (real content, not yet admin-confirmed) are both surfaced everywhere a document or its citations
  appear, including inside the mock provider's answer text and the system prompt sent to Anthropic.

## Knowledge trust levels — DONE

Brief §30's Level A-D trust hierarchy is built as additive to what already existed, not a
replacement:

- `isSample` — "is this fake demo content" (orthogonal to trust — a sample doc is never real,
  regardless of trust level)
- `needsReview` — "is this real but not yet admin-confirmed" (a temporal/workflow state)
- `trustLevel` — "whose authority does this carry, once confirmed": A_OFFICIAL (published
  curriculum), B_INSTRUCTOR_APPROVED (reviewed instructor material), C_REFERENCE (general
  reference, e.g. glossary — the schema default), D_COMMUNITY (student-contributed, brief §21's
  reputation content — no community feature exists yet to populate this, but the tier is real and
  ready)

Both providers factor it in: `MockProvider` adds a community-content caution note (parallel to the
existing sample/needsReview notes) when any cited chunk is `D_COMMUNITY`; `AnthropicProvider`'s
system prompt instructs the model to present A/B sources with normal confidence, C as background
rather than a school rule, and D as one student's perspective, never official methodology,
regardless of how confidently the source text itself is phrased. Citation UI (both admin and
student chat) shows a trust-level label next to each source. Admin sets/changes a document's trust
level from `/admin/knowledge` — a data change, not a code change, per brief §30's "the AI should
know the difference" being enforced by the field itself, not by trusting content authors to
self-report accurately (a community post claiming to be an "official rule" doesn't become one
because it says so — `trustLevel` is admin-set, never client-supplied).

## Student-facing AI Tutor — DONE

`/student/ai-tutor` reuses the exact same retrieval/provider/citation pipeline as the admin chat
(`ChatClient.tsx` is now a shared component, parameterized by `endpoint`/`historyBasePath` rather
than duplicated) — proving the "same infrastructure, different surface" design this doc always
assumed. Own Route Handler (`app/api/student/chat/route.ts`), not a shared one with admin: gated
by `studentCan(USE_AI_TUTOR)` (403 if not entitled), and every conversation read/write is scoped
by `studentId` at the query layer — a student can only ever create or continue their own
`Conversation` (`scope: "STUDENT"`), never an admin's or another student's.

**A real isolation bug was found and fixed while verifying this**: the route originally used
`findUniqueOrThrow` to look up an existing conversation scoped to the caller. Passing another
student's real conversation ID correctly found *no matching row* (the isolation itself was never
broken — `studentId` was already part of the `where` clause), but `findUniqueOrThrow` throwing on
that miss produced an unhandled exception and a raw 500 with a stack trace in the server log,
rather than a clean 404. Fixed by switching to `findFirst` + an explicit not-found response.
Verified via a raw hijack-attempt `fetch()`: before the fix, 500 with no response body (no data
leaked, but noisy); after, a clean `404 {"error":"Conversation not found"}`. No successful hijack
was ever possible either way — this was a robustness/hygiene fix, not a closed data-leak — but a
500 on an authorization boundary is exactly the kind of symptom worth chasing down rather than
shrugging off as "well, it didn't leak anything."

## Planned: uncertainty categories (Phase 4-5)

Brief §11: distinguish FACT / OBSERVATION / INTERPRETATION / HYPOTHESIS / TRADING_X_RULE / UNKNOWN
where the distinction matters — chiefly in Chart Lab responses (below) and journal-intelligence
insights (`AiInsight`, see `DATABASE.md` §2.4). Concretely: an AI observation like "price swept the
prior day's high" is closer to FACT/OBSERVATION; "this looks like a liquidity grab before reversal"
is INTERPRETATION; "you tend to perform worse after two losses" is a HYPOTHESIS unless the sample
size crosses a defined evidence threshold. **Never manufacture confidence percentages merely to
look intelligent** — this is a repeated instruction in the brief and matches the root
`quant_platform/KNOWLEDGE_BASE.md`'s existing rejection of "improving PF with falling trade count"
as false confidence on the trading-research side. If the methodology doesn't define something, the
AI says so rather than inventing a Trading X rule.

## Socratic Chart Lab tutor (Phase 5) — DONE (core loop), 2026-08-11/12

When a student answers "what do you see?" on a chart exercise, `socraticFollowUp()`
(`app/lib/ai/provider.ts`) asks one targeted follow-up (mock mode picks from a fixed question bank
in `app/lib/domains/chartlab/socratic.ts`; real mode, when `ANTHROPIC_API_KEY` is set, asks Claude
via a system prompt that forbids grading, confirming, or revealing the read) rather than
immediately telling the student what to think. Verified live in-browser 2026-08-12.

**Two things described here are still not built, not just unverified:**
- **The AI never sees the chart image**, even in real-provider mode — `socraticFollowUp()` sends
  only the exercise prompt text and the student's typed response to Claude, not the `imageDataUrl`.
  The follow-up is grounded in what the student wrote about the chart, not independent visual
  analysis of it.
- **No level-tuned scaffolding.** The TEACHER → COACH → QUESTIONER → REVIEWER posture shift by
  student `Level` (`DATABASE.md` §2.5) isn't wired in — question selection is deterministic on
  `priorAnswerCount` only, the same for a brand-new student and an advanced one.

## Hard boundary: deterministic calculations never come from the AI

R-multiples, drawdown, XP totals, concept-mastery transitions, Trader Score (brief §25) — all
plain, testable code. The AI may *interpret* an already-computed number ("your drawdown behavior
worsened this week") but never *compute or silently adjust* it. This mirrors the root `CLAUDE.md`'s
existing rule for the trading side of this repo ("AI layer can only ever produce a `Signal`; only
the deterministic Risk Manager + Execution Adapter can touch a broker") — same shape, same reason:
an LLM's job here is language and judgment support, not arithmetic authority, and mixing the two
makes both unauditable.

## AI security posture (Phase 1 onward, hardens as surfaces grow)

Treat the AI as an untrusted subsystem, per brief §35 and the root `vault/00-Home/SECURITY.md`'s
existing prompt-injection stance generalized to this project:

- **No unrestricted database access.** The AI reads through the same retrieval/citation interface
  everything else uses — narrow, purpose-built read paths, not a raw query tool.
- **No unauthorized actions.** Anything AI-proposed that has a real effect (sending a message,
  changing a student's status) goes through the existing `Approval` table for human sign-off — this
  mechanism already exists in the schema, just unused since nothing produces requests yet.
- **Uploaded content (charts, documents) and community posts are untrusted input** — validated on
  upload, and never allowed to alter the system prompt or override instructions (retrieval-poisoning
  and prompt-injection surface, brief §35). A community post claiming to be an "official rule" does
  not become one because it was phrased that way — trust level is a database field the content
  author cannot set for themselves.
- **No data leakage between students — DONE, verified.** Chat conversation history is filtered by
  the authenticated student's own `studentId` at the query layer (`app/api/student/chat/route.ts`,
  `/student/ai-tutor`'s page query), not just hidden in the UI. Verified in-browser: a second
  student's chat history page showed empty, and a direct hijack attempt (real `fetch()` with
  another student's conversation ID) was correctly rejected. Journal data isolation verified the
  same way in Phase 3 — see `SECURITY.md` §2.1 and `PROJECT_STATE.md`.

## Content versioning and AI knowledge (ties to CURRICULUM_SYSTEM.md)

Updating a lesson must not silently destroy the knowledge an existing AI conversation relied on.
Once `LessonVersion` exists (Phase 2, see `DATABASE.md`), `DocumentChunk`/`Citation` references
should resolve to the specific version cited at the time, not "whatever the lesson currently says"
— so an old conversation's citations stay accurate even after the curriculum changes.
