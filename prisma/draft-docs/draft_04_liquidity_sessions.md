# Liquidity Sweeps & Session Context

> DRAFT — extracted and generalized from internal research notes (`PROJECT_NOTES.md`) with all
> specific strategy names, parameters, and performance numbers removed. Complements the other
> SAMPLE market-structure documents already in this knowledge base. Needs your review before being
> treated as confirmed methodology.

## Liquidity sweep + confirmation, as a signal concept

A liquidity sweep is price briefly trading through a level where resting orders are likely to
cluster (a prior swing high/low is the classic example) and then reversing — the idea being that
the move through the level triggered/absorbed the resting liquidity there rather than being a
genuine breakout. On its own, "price poked through a level and came back" is a weak signal — it
happens constantly and much of the time is noise.

**Pairing a sweep with a confirmation condition** (for example, a volume spike on the bar that
closes back through the level) is what turns a raw sweep observation into a more selective signal.
The general principle: a sweep by itself only tells you liquidity was *present* at that level; a
confirmation condition is what gives you evidence that liquidity was *meaningfully absorbed and
reversed*, rather than the level simply being crossed on the way to somewhere else.

**A concrete lesson on validating a confirmation filter**: don't assume a confirmation condition is
adding real selectivity just because trade count doesn't change when you disable it — check
directly what fraction of all bars actually satisfy the confirmation condition. If it's a small,
selective fraction, and it's *already* almost always true whenever the base signal's other
conditions are met, that's a meaningful, real correlation (the two conditions tend to co-occur for
a sensible underlying reason), not evidence the filter is decorative. Measure the actual pass
rate directly rather than inferring it indirectly from whether removing the filter changed the
trade count.

## Session context: liquidity conditions vary by time of day

Not all trading sessions have equivalent liquidity or participation. A signal type that depends on
genuine institutional participation (like a liquidity-sweep-plus-volume-confirmation signal) can
behave differently across sessions — thinner-liquidity sessions can produce more false confirmation
signals that don't reflect real institutional flow, simply because less volume is needed to trigger
a "spike" relative to that session's own lower baseline.

**The generalizable lesson, not a specific rule to copy:** always check whether a signal's
performance is uniform across trading sessions before assuming it is. If it isn't, that's useful
information about *why* the signal works (or doesn't) — not just a filter to bolt on for a better
backtest number. Session-based analysis is a specific case of the broader "check the distribution,
not just the aggregate" discipline described in the backtesting-discipline document.

## Why this pairs with the existing sample market-structure docs

This document is about *signal construction and validation discipline* around liquidity/sweep
concepts. The existing SAMPLE documents in this knowledge base (multi-timeframe structure,
liquidity/displacement glossary, volume profile) cover the *vocabulary and definitions* for the
same concept family. Once real curriculum content replaces the SAMPLE docs, this document's
concepts should be reviewed for whether they belong merged into that material or kept as a
separate "how we validate a signal" lesson.
