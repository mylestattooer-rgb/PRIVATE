# PRODUCT_SPEC — Trading X

Status: Phase 0 (discovery). This document states product philosophy and direction. For what is
actually built today, see `PROJECT_STATE.md` — that file's WORKING/MOCKED/NOT-YET-IMPLEMENTED
table is the single source of truth on build status; this file does not duplicate it.

## What Trading X is

Trading X is the long-term product this codebase (currently named "Trading School OS") is
growing into: a premium, AI-powered trading education and development platform that takes a
student from knowing nothing about markets through progressively deeper competence, until they
can analyse markets, formulate ideas, manage risk, journal performance, understand their own
behaviour, and make independent trading decisions without needing the platform to tell them what
they're looking at.

It is explicitly **not**: a video course, a signals group, a Discord/Skool replacement in the
shallow sense, a generic AI chatbot, a collection of indicators, or a prop-firm gambling tool. It
is a Trader Development Operating System — education, practice, simulation, assessment, AI
tutoring, journaling, performance analysis, gamification, community, and prop-firm preparation as
one connected ecosystem, not a bundle of separate tools.

## Core philosophy: develop ability, not information

Most trading education teaches information. Trading X must develop ability. The intended student
progression:

```
LEARN → UNDERSTAND → IDENTIFY → EXPLAIN → PRACTICE → SIMULATE → EXECUTE → REVIEW → CORRECT → MASTER
```

The platform should continuously answer "what does this trader actually understand?" — not
"what videos have they watched?" Watching a lesson does not prove competence. As the platform
matures (see `ROADMAP.md` Phase 2 onward), progression increasingly requires demonstrated
understanding: quiz performance, chart recognition, scenario assessments, simulator performance,
not just lesson-completion checkboxes.

This mirrors a principle already load-bearing on the trading-research side of this repo (root
`CLAUDE.md`): results only count once they survive scrutiny, not once they look good on the
surface. Applied here: a student's progress score only counts once it's backed by demonstrated
performance, not merely time spent in the app.

## Beginner-first design

Assume a new student knows absolutely nothing. Do not assume they understand what trading is,
what a market or a chart or a candle represents, what buying/selling/short-selling means, what a
broker does, where deposited money goes, what leverage/margin/spread/lot/contract/risk/liquidity
mean, why price moves, or what actually happens when they press Buy or Sell.

Trading X should answer the questions traditional trading education skips. A beginner should
never feel stupid for not knowing something. The system progressively builds their mental model
from first principles — this is a curriculum-sequencing requirement (see `CURRICULUM_SYSTEM.md`
prerequisite model), not just a tone guideline.

## Product domains

The full long-term feature surface, grouped as the product actually experiences them (not as a
literal 1:1 map to code modules — see `ARCHITECTURE.md` for the code-level domain boundaries):

- **Education** — lessons, curriculum, prerequisites, multiple content types
- **Assessment** — quizzes, chart recognition, scenario training
- **Chart Lab** — "what do you see?" chart-analysis exercises, AI Socratic questioning
- **Simulator** — historical replay, hypothetical order execution, no look-ahead leakage
- **Journal** — student-owned trade records, AI-assisted pattern detection (never overwritten by AI)
- **Progression** — levels, concept mastery states, XP, achievements, challenges
- **AI Tutor** — retrieval-grounded, methodology-scoped, Socratic by default, honest about
  uncertainty
- **Prop-firm preparation** — configurable rule profiles, simulated evaluations
- **Community** — education-focused discussion, chart sharing, reputation for useful contribution
- **Personal development** — behavioural pattern insight, always evidence-backed, never diagnosis

## Student home — "The Terminal"

The student's home screen should immediately answer: where am I, what am I learning, what should
I do next, how am I performing, where am I weak, what have I achieved, what needs attention. The
interface itself should start simple for a beginner and progressively surface more
trading-terminal-like density as the student advances — not present full complexity on day one.

## AI's role: reduce dependency over time

This is a hard product principle, not a nice-to-have: Trading X succeeds when students need the
AI *less* over time. The AI's posture should shift as a student advances:

```
TEACHER → COACH → QUESTIONER → REVIEWER
```

Beginners get substantial guidance. Advanced students get challenged to think independently. The
Chart Lab AI in particular must resist simply telling a student what trade to take — it asks what
they see, then asks targeted follow-up questions (what makes you consider that a sweep, where
would the idea invalidate, what's the higher-timeframe context) rather than handing over an
answer. Full behavior spec in `AI_ARCHITECTURE.md`.

## Explicit non-goals for now

Naming this here so scope creep is visible when it happens: no real trades, no broker fund
movement, no live risk of any kind — this platform is educational/simulated only, full stop, and
that boundary is permanent, not a Phase 1-only caveat. No claim of certainty on subjective chart
interpretation (see `AI_ARCHITECTURE.md`'s FACT/OBSERVATION/INTERPRETATION/HYPOTHESIS/RULE/UNKNOWN
distinction). No personalized financial advice. No AI-invented Trading X methodology — if the
curriculum doesn't define something, the AI says so rather than filling the gap.

## On the name

This codebase and its docs currently say "Trading School OS" throughout (`package.json`, README,
UI copy). Renaming to "Trading X" in code is a cheap, purely cosmetic change with no architectural
consequence — deferred rather than done opportunistically mid-refactor, so it lands as one clean,
reviewable commit whenever it's actually wanted rather than scattered across unrelated changes.
