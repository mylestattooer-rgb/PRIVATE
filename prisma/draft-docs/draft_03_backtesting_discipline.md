# Backtesting Discipline: Avoiding Self-Deception

> DRAFT — extracted and generalized from internal research notes (`PROJECT_NOTES.md`,
> `quant_platform/KNOWLEDGE_BASE.md`) with all specific strategy names, parameters, and performance
> numbers removed. Describes *methodology discipline*, not any specific validated result. Needs
> your review before being treated as confirmed teaching material.

This is arguably the most important lesson set in the whole knowledge base: a backtest number is
never the goal by itself. It only counts once it survives scrutiny. Below are concrete, repeatable
checks — not abstract advice.

## Red flag: profit factor rising while trade count keeps falling

If sweeping a parameter shows the metric you care about (e.g. profit factor) improving
monotonically while the number of trades in the sample keeps shrinking, that is the *same shape*
as overfitting to a smaller and smaller, more curve-fit-friendly subset of history — not
confirmation the parameter is "better." Treat an improving headline metric with a falling trade
count as a signal to double-check, not a finding to report, until it passes a significance check.

## Red flag: the best result sits exactly on a tested parameter's boundary

If a parameter sweep's best result lands exactly at the edge of the range you tested (the minimum
or maximum allowed value), and performance was still monotonically improving as it approached that
edge, that's a warning sign — it suggests the backtest would keep "improving" if you pushed the
parameter further, for reasons that have nothing to do with a real, generalizable edge. Prefer a
less extreme point on the same sweep over the absolute in-sample-best when deciding what to
actually deploy.

## Walk-forward validation: profitable in both halves is good, but read the shape

Splitting available history into an earlier and later period and testing the same (already-tuned)
configuration on each independently is a basic guard against curve-fitting to the whole sample at
once. Both halves being profitable is a genuinely good sign — many purely curve-fit configurations
go negative the moment you leave the exact window they were tuned on. But if the two halves differ
sharply (e.g. one clearly stronger than the other), that's evidence the edge is not uniform over
time, and confidence should be calibrated accordingly — "positive on average, with real variance"
is a different, weaker claim than "a stable, always-on edge."

## Concentration risk: an aggregate metric can hide a lopsided result

Looking at performance in rolling sub-windows (e.g. by quarter) rather than only the full-history
aggregate can reveal that a small number of favorable periods are doing most of the work. A
headline profit factor computed over the whole history can be technically true while still being a
misleading summary if, say, one strong quarter contributed more net profit than several other
quarters combined. Always check the distribution, not just the total.

## Short backtest windows are not reliable evidence either way

A backtest run over a short window (a few months) is not trustworthy evidence that a signal design
works — nor, on its own, that it doesn't. The internal lesson that generalizes: apparent "leaders"
found by screening many ideas on a short window frequently fail once tested on a much longer real
history, while the design that ultimately held up was found by principled reasoning about *why* it
should generalize (not by screening a short window and picking the best-looking result).

## Don't assume an edge generalizes to a new instrument or timeframe

An edge validated on one instrument (or timeframe) should be treated as unproven on a different one
until independently re-tested — including re-tuning parameters that may have been implicitly
calibrated to the original instrument's volatility character (e.g. lookback windows). Reusing an
existing tuned configuration unmodified on a new instrument is not a fair test of whether that
instrument has similar exploitable structure; it's a test of portability, and portability failing
doesn't mean the new instrument has no edge to find, only that this specific configuration wasn't
built for it.

## Repainting and lookahead bias: know what you're checking, and why

A backtest can look profitable purely because it's (even inadvertently) using information that
wouldn't have been available at the time a real trade decision was made — this is called
repainting or lookahead bias. Two concrete things to check for:
- Any reference-timeframe data pulled into a lower-timeframe strategy must be explicitly configured
  to not look ahead of the current bar.
- Signal logic should evaluate using only fully-closed bars, and should exclude the current
  forming bar from its own reference levels.

One honest, universal caveat even in a clean audit: if a platform fills simulated orders at the
same bar's close price that generated the signal, that's mildly optimistic versus real execution
timing — worth naming explicitly as a platform-level limitation rather than treating the backtest
as perfectly execution-realistic.

## Stress-test the edge, don't just measure it once

Beyond a single backtest run, deliberately widening assumptions the strategy depends on (e.g.
simulating a larger spread/cost than the realistic baseline) shows whether an edge has real margin
or is thin. A strategy whose profit factor crosses below breakeven under a moderately larger cost
assumption than the realistic baseline should be treated as a *thin* edge — real, but with limited
room for execution slippage — which should change position sizing and confidence, not just get
filed away as a caveat.
