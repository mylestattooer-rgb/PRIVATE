# Research Discipline: How We Evaluate Whether Something Actually Works

> DRAFT — adapted from the operating principles used across this school's own trading research
> (`CLAUDE.md`). These are process/philosophy rules, not specific trading rules, and contain no
> proprietary parameters or results. Still flagged for your review before being treated as
> confirmed teaching material, since the wording was adapted rather than copied verbatim.

Optimizing a single backtest number is never the goal by itself. A result only counts once it
survives realistic costs, a long enough real history to mean something, and an honest look for
overfitting. These are the standing rules behind that discipline:

## Every signal needs a reason, not just a number

A trading signal should come with a human-readable reason and a confidence level, decided *at the
moment the signal fires* — not reconstructed afterward to justify a result that already happened.
A signal you can't explain in plain language at the time you'd act on it is a signal you don't
actually understand yet.

## Regime detection and risk control are core design, not add-ons

Deciding *when* a strategy should be active (see the regime-aware design document) and enforcing
risk limits are first-class parts of a trading system's design from the start — not something
layered on after a strategy already "looks good" in an unconditional backtest.

## Keep negative results — a rejected idea is still information

A hypothesis that failed real testing is worth recording with the same care as one that succeeded.
Deleting failed ideas just means someone re-tests the same idea again later without knowing it
already failed, and for what specific reason. A research log that only records wins is not a
research log, it's a highlight reel.

## Push back on results improved by shrinking the sample

A result that only got better by narrowing down to fewer, "cleaner" trades needs a significance
check before it counts as a finding. An improving win rate or profit factor alongside a shrinking
trade count is not evidence on its own — see the backtesting-discipline document for the concrete
version of this check.

## No real trades, no fund movement, without a deliberate, separate human action

Simulated results and paper/demo testing are how ideas get evaluated. Moving from "this looks
validated" to actually risking capital is always a distinct, deliberate step taken by a person —
never something that happens automatically because a backtest, or an AI system, said so.
