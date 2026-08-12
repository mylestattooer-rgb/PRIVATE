# HeyGen Content Pipeline — Feasibility Audit & Architecture Proposal

**Status:** Proposal / research complete, nothing built or purchased. **Recommendation: Conditional GO** — start with the free tier manually, no API spend, no automation, until three specific unknowns are resolved empirically (see §8).

**Date:** 2026-08-11. Research sources are dated where found — HeyGen ships fast, re-verify anything older than a few months before acting on it.

Target pipeline (as specified):

```
Obsidian vault  ->  Claude/agents  ->  script generation  ->  HeyGen render  ->  Digital Twin + cloned voice
   ->  finished video  ->  human review/approval  ->  publish
```

Use cases: Trading X lessons, market breakdowns, Sunday Positioning videos, course/module videos, short-form social clips, announcements, promo, explainers, automated variations, potential multilingual versions.

---

## 1. What HeyGen actually adds

Nothing in this repo currently does video generation, avatar rendering, or voice cloning — confirmed by grepping `trading_school/` for `heygen|avatar|video|script|publish` (see §2). HeyGen would be a genuinely new capability: turning a written script into a video of you (or a digital likeness of you) speaking it, without you filming anything per-video.

## 2. What already exists (avoid duplicating)

Audited directly (file paths, not guesses):

- **AI provider abstraction** — [`trading_school/app/lib/ai/provider.ts`](app/lib/ai/provider.ts). Clean `AiProvider` interface, `AnthropicProvider` calls Claude directly via `fetch()` (model hardcoded `claude-sonnet-5`), key read from `process.env.ANTHROPIC_API_KEY`, singleton factory `getAiProvider()`. **This is exactly the thing script-generation should call into** — no new LLM plumbing needed, just a new call site (and probably a longer `max_tokens` than the 1024 used for chat answers).
- **No orchestration/job-queue infrastructure anywhere in the repo.** Every existing AI call is synchronous request→response from a Server Action or Route Handler. A HeyGen pipeline needs async job tracking (poll or webhook for a render that takes minutes) — this has to be built from scratch, nothing to reuse.
- **Agent R&D System** (`agents/`, `AGENT_CONSTITUTION.md`, `AGENT_RD_SYSTEM_PROPOSAL.md`) — this is a **manual, per-invocation prompt-template system for trading-strategy research** (Meridian-7 vertical), not executable automation. A human Supervisor hand-picks a role file and spawns one Agent tool call at a time; `ledger/db.py`'s sqlite tables are a bookkeeping trail written by hand, not a dispatcher. **Nothing here can be "called" by a content pipeline** — if Claude-driven script generation should follow this project's agent conventions, the pattern to imitate is "one well-scoped Agent call per script," not an integration with existing code.
- **Trading School OS roadmap** (`PROJECT_STATE.md`) has zero mention of video/content pipeline — Phase 5 (Chart Lab) is next, long-term vision section doesn't mention this either. This is a **net-new initiative**, not a natural extension of a planned phase.
- **`Approval` Prisma model** exists in `trading_school/prisma/schema.prisma` but nothing writes to it or reads it yet (confirmed in `PROJECT_STATE.md`'s own notes). This is the one existing schema artifact worth reusing/extending for the "no auto-publish without approval" gate, rather than inventing a parallel approval concept.
- **Obsidian vault has no programmatic reader.** `vault/_scripts/sync_vault.py` is a one-way hard-link mirror for canonical docs, run manually, not a content API. No `Trading X` folder exists under `vault/20-Projects/` today. Vault-as-knowledge-source for this pipeline means **new ingestion code**, not something to plug into.
- **Secrets convention is simple and consistent**: `.env` (git-ignored) + `.env.example` (checked in), read via plain `process.env.X` at point of use — see `ANTHROPIC_API_KEY` in `provider.ts`. A `HEYGEN_API_KEY` should follow the identical pattern.

**Bottom line: HeyGen would sit on top of the existing Anthropic provider (reused) and the existing `Approval` model (extended), but everything else — job orchestration, vault ingestion, HeyGen client, review UI — is new.**

## 3. HeyGen API — what's actually confirmed vs. marketing-only

Full detail in the research transcript this document is derived from; key facts:

| Area | Confirmed | Open / unconfirmed |
|---|---|---|
| API access | Pay-as-you-go, separate credit pool from web subscription, $5 min purchase, no free API credits as of Feb 2026 | — |
| Digital Twin creation | `POST /v3/avatars` (`type: "digital_twin"`) trains from **2–5 min of 1080p+ video**, async, ~10–20 min turnaround | Marketing page separately calls "Digital Twin Creation API" **Enterprise-only** — contradicts the docs. **Must test with a real API key before assuming self-serve can train programmatically.** |
| Voice cloning | `POST /v3/voices/clone`, async, returns `voice_clone_id` | One doc surfaced a 403 "not available on free tier" — unclear if that gate applies to pure API-credit accounts. **Untested.** Accent/regional-accent preservation on clone: **not documented, needs an empirical test.** |
| Expression/gesture control | `motion_prompt` (free text), `expressiveness` (`high`/`medium`/`low`) — no discrete `emotion` parameter | Whether the web UI has finer sliders not exposed via API: unconfirmed |
| Generation | `POST /v3/videos`, async + webhook or poll, batch up to 100/call, 4K/1080p/720p, script cap 5,000 chars, audio-input cap 10 min | **Numeric rate limits (req/min) are not published.** Only confirmed cap: **10 concurrent processing jobs** on pay-as-you-go, HTTP 429 beyond that |
| Pricing | Avatar III $1/min, Avatar IV $4/min, Translation $2/min, Video Agent $2/min (HeyGen's own dated help article, Apr 2026) | Several third-party numbers for Avatar V / 4K contradict each other — don't budget off those |
| Commercial use / consent | Commercial use allowed on all paid tiers (even Free, watermarked); Digital Twin creation requires a one-time consent step (`POST /v3/avatars/{id}/consent`) | Exact consent-tier mechanics (Level 1/2/3) came from a summarized doc fetch, medium confidence — verify the raw page before building around it |
| Content moderation | Automated ML + human-review filters block violating content; **no documented mandatory pre-approval on every generated video** | Whether financial/trading language ("risk," "loss," chart images) trips false positives: **untested — real operational risk for an automated pipeline** |
| Reliability | 99.9%+ uptime on status page; a handful of minor incidents in the trailing 90 days, nothing chronic | — |

**Five things that can only be answered by actually calling the API, not by reading more docs:**
1. Can a self-serve (non-Enterprise) key train a Digital Twin via API?
2. Does voice cloning need a paid *web* subscription on top of API credits?
3. Does the clone preserve your actual accent, or normalize it?
4. What's the real requests-per-minute ceiling?
5. Does trading-education language/imagery trip the content moderation filter?

## 4. Expected costs

- **Free tier (your instruction — start here):** $0. 3 videos/month, 1 min max each, 1 digital twin, 1 voice clone, **watermarked**. Enough to test avatar/voice quality and answer questions 1–3 above (train one twin, clone one voice, generate a few short test clips) — not enough for any real content volume, and watermarked output isn't publishable.
- **Paid API, if it proceeds later:** Avatar IV at $4/min is the realistic per-video cost line (Avatar III at $1/min is lower fidelity, probably not "Digital Twin" quality). A monthly batch of, say, 8 pieces of content averaging 3 minutes each ≈ 24 min/month ≈ **$96/month** at Avatar IV rates, before accounting for voice-clone or translation add-ons, and before Claude API tokens for script generation (small by comparison — a few cents per script).
- **Enterprise tier:** custom pricing, only relevant if self-serve API training turns out to be gated (open question #1).

## 5. Security / privacy considerations

- `HEYGEN_API_KEY` follows the exact existing pattern: add to `trading_school/.env.example` (blank) and `trading_school/.env` (real value, git-ignored), read via `process.env.HEYGEN_API_KEY`. No new secrets-handling design needed.
- The digital twin video and voice-clone source audio are themselves sensitive biometric material (your face + voice, from which a synthetic version can be generated) — store the source training video/audio outside the repo (not in `vault/`, not committed anywhere), and treat the resulting `avatar_id`/`voice_clone_id` as secrets-adjacent (not literally exploitable like an API key, but not something to put in a public changelog either).
- Per §3, HeyGen's consent flow is mandatory for Digital Twin creation — this is actually a useful built-in safeguard against someone else training a twin of your likeness through a leaked API key, since consent is tied to the specific upload.
- The "no auto-publish" approval gate (§7) is itself a privacy/reputation control, not just a quality control — a factually wrong or badly-generated video of your digital twin going out automatically is a materially worse failure mode than a wrong blog post, because it's *you* saying it on camera.

## 6. Proposed architecture (once past the free-tier pilot)

```
Obsidian vault (vault/20-Projects/2X-Trading-X/, new folder)
        |
        v
[Ingestion step — new]  reads specified vault notes, feeds as context
        |
        v
[Script generation — Agent tool call]  uses existing AnthropicProvider pattern,
        produces: script text + suggested motion_prompt/expressiveness + metadata
        |
        v
[Job record — new Prisma model, e.g. ContentJob]  status: DRAFT -> SCRIPT_READY -> RENDERING -> PENDING_APPROVAL -> APPROVED -> PUBLISHED | REJECTED | FAILED
        |
        v
[HeyGen client — new]  POST /v3/videos, store video_id, poll or receive webhook
        |
        v
[Review UI — extends existing admin app]  shows script + rendered video side by side,
        human checks facts/numbers before flipping ContentJob to APPROVED
        |
        v
[Publish step — new, manual trigger initially]  no auto-posting to any platform in v1
```

Key design decisions (made per your "don't stop to ask" instruction):

- **Claude does reasoning/scripting, HeyGen is purely the rendering layer** — matches your requirement in §4 of the brief. No business logic, fact-checking, or numeric validation happens inside HeyGen; it only ever receives a finished script.
- **Async job model, not synchronous** — HeyGen renders take minutes; the `ContentJob` status machine is the natural fit, mirroring the existing `Lesson.status` (`DRAFT|REVIEW|PUBLISHED|ARCHIVED`) enum pattern already used elsewhere in the same Prisma schema, and reusing the existing (currently-unused) `Approval` model for the human sign-off step rather than inventing a second approval concept.
- **No publishing automation in v1.** The brief asks for an approval gate before anything publishes — the simplest correct version of that is: v1 doesn't publish anywhere automatically at all, a human takes the approved video and posts it manually. Auto-publishing to specific platforms is a separate, later decision with its own credentials/API surface per platform, out of scope until the render pipeline itself is proven.
- **One `ContentJob` per video, not a batch abstraction**, even though HeyGen supports batch requests — batching is a cost/throughput optimization to revisit only once real volume justifies it; premature batching would just make the approval-gate logic more complicated for no benefit yet.

## 7. Approval / no-auto-publish gate

Extend the existing (currently unused) `Approval` Prisma model rather than adding a parallel concept:
- `ContentJob` moves to `PENDING_APPROVAL` only after a render successfully completes.
- A reviewer (you) opens the job, watches the rendered video next to the source script and the specific vault notes/numbers it was generated from, and can only move it to `APPROVED` or `REJECTED` — no status skips this step.
- Numeric/factual claims (prices, dates, statistics) in the script should be highlighted for review specifically, since these are the highest-cost failure mode for trading-education content — this can start as a simple regex-based highlighter (numbers, %, currency) in the review UI, not an AI-based fact-checker, until there's a reason to build more.
- Nothing reaches `PUBLISHED` except by explicit human action. No cron, no auto-retry-then-publish.

## 8. Recommended implementation order

Reordered per your "use the free tier, not buying yet" instruction:

1. **(This week, $0 cost, manual, no code)** Use the HeyGen free web tier directly: train your one free Digital Twin, clone your one free voice, generate 2-3 one-minute test clips using scripts you write by hand. This directly answers open questions #1 (well, the *training* part — free tier training is via UI so it doesn't resolve the API-training question, but does resolve avatar/voice *quality*) and #3 (accent preservation) at zero cost, and gives you a real basis to judge whether the output is good enough to build a whole pipeline around before spending anything further.
2. **(If quality is good)** Buy the $5 minimum API credit block, and make three raw API calls by hand (or via a throwaway script, not integrated into the app) to resolve open questions #1, #2, #4 for real: attempt `POST /v3/avatars` with `type: digital_twin` on a self-serve key, attempt `POST /v3/voices/clone`, and send enough rapid `POST /v3/videos` calls to find the real rate limit. This is a ~$5-10 spend, not a commitment to the full build.
3. **(If steps 1-2 check out)** Build the smallest possible proof-of-concept (see below) — one hardcoded script, one manual trigger, no vault ingestion yet, no scheduling, just: script in → HeyGen render → shows up in a basic review page → manual approve. Prove the async job-tracking and approval-gate mechanics work before adding vault ingestion or Claude-driven script generation on top.
4. **(Only after step 3 works end-to-end)** Wire in Claude-driven script generation from a hardcoded prompt template (still no vault ingestion).
5. **(Last)** Vault ingestion — pick one real vault folder (a new `vault/20-Projects/2X-Trading-X/` per this repo's convention) and connect it as the source of truth for script generation.

This order deliberately front-loads the two cheapest, fastest ways to kill the project if it's not going to work (free-tier quality check, then a $5 API probe) before any integration code gets written — consistent with "don't waste credits/tokens on unnecessary generations."

## 9. GO / NO-GO

**Conditional GO.** The architecture is sound and cheap to build (most of the new work is a job-status table and a thin HeyGen client — the expensive part, script generation, already has a home in `provider.ts`). But three things are still empirically unverified and materially affect whether this is worth building at all:

1. Whether the output quality (this is the thing your "laggy/doesn't look good" comment may already be telling us something about — see my question above) is good enough to represent you credibly to students.
2. Whether self-serve API access can actually automate Digital Twin training and voice cloning, or whether that requires an Enterprise contract (which changes the cost/complexity picture substantially).
3. Whether HeyGen's content moderation tolerates trading/financial-education language without false-positive blocking.

None of these block starting — they block moving past step 1 in §8. **Start with the free tier this week, at zero cost and zero code, and that alone will answer the question that matters most (quality) before anything else gets built.**

## 10. Smallest possible proof-of-concept (once free-tier quality checks out)

A single new page under the existing admin app, not a new service:

- One new Prisma model: `ContentJob { id, script, status, heygenVideoId, videoUrl, createdAt, approvedAt, approvedBy }` (status enum matching §6).
- One new route: `POST /api/content-jobs` — takes a hardcoded/pasted script, calls HeyGen's `POST /v3/videos` with your (by-then-tested) avatar/voice IDs stored in `.env`, saves the `video_id`, sets status `RENDERING`.
- One polling job (a simple `setInterval` in dev, or a manual "check status" button — no real scheduler yet) that calls HeyGen's status endpoint and flips the job to `PENDING_APPROVAL` with the resulting `videoUrl` when done.
- One review page: lists jobs in `PENDING_APPROVAL`, shows the script text and an embedded video player, two buttons (`Approve`/`Reject`).

No vault reading, no Claude script generation, no publishing integration — this POC exists purely to prove the render→review→approve mechanics work, using one script you paste in by hand. Everything upstream (vault ingestion) and downstream (publishing) plugs into this skeleton later.
