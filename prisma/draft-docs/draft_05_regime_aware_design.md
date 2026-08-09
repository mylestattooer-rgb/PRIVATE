# Regime-Aware Strategy Design

> DRAFT — extracted and generalized from internal notes (`quant_platform/KNOWLEDGE_BASE.md`) with
> all specific strategy names, parameters, and performance numbers removed. Describes a *design
> principle*, not a specific validated result. Needs your review before being treated as confirmed
> methodology.

## Not every strategy should trade in every market condition

A "market regime" is a classification of current conditions — for example, trending vs. ranging,
or low-volatility vs. high-volatility. The core design principle: a given strategy's edge is
usually tied to a *specific* regime, not to markets in general. A trend-following mechanism, for
instance, is built around an assumption (sustained directional moves exist to be captured) that
simply isn't true in a genuinely range-bound, low-volatility market — trading it there isn't a
smaller version of the same edge, it's a different environment the mechanism wasn't designed for.

**The practical implication for platform/system design:** regime detection, and *deciding which
strategy (if any) should be active in the current regime*, deserves to be a first-class part of
the system — not an afterthought bolted on after a strategy already looks good in an unconditional
backtest. A strategy that's genuinely profitable "on average" across all regimes combined can still
be actively losing money in the regimes it wasn't built for, offset by strong performance in the
regime it was built for. Recognizing which regime is which, and only trading a strategy in the
regime(s) it's actually suited to, is a different (and generally better) design than one
always-on strategy trying to handle every condition.

## Timeframe generalization has a real boundary, and it's usually cost-driven

Testing whether a signal mechanism holds up across a range of timeframes (not just the one it was
originally built on) is a useful generalization check — but expect it to break down somewhere, and
expect the reason to usually be transaction costs, not signal quality. At very short timeframes,
the average price move a signal is trying to capture can shrink to the point where the spread
becomes a large fraction of that move — a real, mechanically explainable edge/cost boundary, not
random noise. When a mechanism stops working below some timeframe, checking whether cost as a
fraction of average move is the explanation (rather than assuming the signal logic itself is wrong
at that timeframe) is the right first diagnostic step.

## Portfolio breadth (running one strategy across many instruments) is not a free multiplier

It's tempting to think that a validated strategy can simply be pointed at additional instruments to
multiply opportunity. In practice, parameters like lookback windows are often implicitly tuned to
the *volatility character* of the original instrument, even if that wasn't a deliberate design
choice. Reusing them unmodified on a different instrument tests portability, not whether that
instrument has exploitable structure of its own — a failure under those conditions shouldn't be
read as "this instrument has no edge," only as "this specific unmodified configuration wasn't built
for it." Real multi-instrument breadth requires per-instrument calibration, which is a materially
bigger undertaking than pointing the same configuration at more charts.
