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

## Planned: knowledge trust levels (Phase 4)

Brief §30 asks for a Level A-D trust hierarchy (official methodology / instructor-approved /
reference / community). This is additive to what exists, not a replacement:

- `isSample` — "is this fake demo content" (orthogonal to trust — a sample doc is never real,
  regardless of trust level)
- `needsReview` — "is this real but not yet admin-confirmed" (a temporal/workflow state)
- `trustLevel` (new) — "whose authority does this carry, once confirmed": A_OFFICIAL (published
  curriculum), B_INSTRUCTOR_APPROVED (reviewed instructor material), C_REFERENCE (general
  reference, e.g. glossary), D_COMMUNITY (student-contributed, brief §21's reputation content)

The AI system prompt and citation UI should let a `D_COMMUNITY` source visibly read differently
from an `A_OFFICIAL` one — a community answer citing another student's post should never be
presented with the same authority as a citation to published curriculum. §30's rule holds:
community content never automatically becomes authoritative Trading X methodology.

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

## Planned: Socratic Chart Lab tutor (Phase 5)

When a student uploads a chart, the AI's default posture is to ask "what do you see?" before
offering an answer, then ask targeted follow-ups (what makes you consider that a sweep, where
would this idea invalidate, what's the higher-timeframe context, what evidence contradicts your
bias) rather than immediately telling the student what to think. This is a distinct AI *mode* from
the existing admin-chat Q&A mode — same provider/retrieval infrastructure underneath, different
system prompt and turn-taking behavior. Ties directly to `PRODUCT_SPEC.md`'s TEACHER → COACH →
QUESTIONER → REVIEWER posture shift: a beginner gets more scaffolding in this mode than an advanced
student, tuned by the student's current level (see `DATABASE.md` §2.5 `Level`).

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
- **No data leakage between students.** Retrieval and chat scoping must filter by the authenticated
  student's own data (journal, conversation history) — enforced at the query layer, not just the UI.
  This becomes concretely testable once student auth lands (Phase 1) — see `SECURITY.md`.

## Content versioning and AI knowledge (ties to CURRICULUM_SYSTEM.md)

Updating a lesson must not silently destroy the knowledge an existing AI conversation relied on.
Once `LessonVersion` exists (Phase 2, see `DATABASE.md`), `DocumentChunk`/`Citation` references
should resolve to the specific version cited at the time, not "whatever the lesson currently says"
— so an old conversation's citations stay accurate even after the curriculum changes.
