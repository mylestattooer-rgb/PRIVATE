# Signal Confluence: Why Multiple Filters Beat a Single Signal

> DRAFT — extracted from internal research notes (`PROJECT_NOTES.md`) and generalized to strip
> any specific strategy's tuned numbers or names. Describes a *design pattern*, not a specific
> validated configuration. Needs your review before being treated as confirmed methodology.

## The core idea: a confluence gate, not a single-signal trigger

Instead of one signal deciding a trade alone, a confluence-gate design only fires a trade when
every *enabled* independent filter agrees. Each filter answers a different question about the
same potential trade:

- **The core signal engine** — the primary technical trigger (e.g. a structural or liquidity-based
  setup) that identifies *where* a trade might happen.
- **A positioning/sentiment filter** (optional) — checks whether larger market participants'
  reported positioning supports the same direction, so the trade isn't fighting a strong
  contrary flow.
- **A seasonality filter** (optional) — checks whether the current calendar period has
  historically favored this direction, as a soft additional filter (see the backtesting-discipline
  doc for why this needs a large sample before being trusted).
- **A volatility regime filter** (optional) — skips trades when volatility is in a low/choppy
  percentile, since many signal types (breakouts, sweeps) are less meaningful in a dead market.

Each filter is optional and defaults to "no opinion" (a no-op) until deliberately configured — the
design principle is that adding a filter should only ever make the system *more* selective, never
introduce a dependency that silently blocks all trading if left unconfigured.

## Why this is worth teaching as a pattern, not just describing one strategy

The generalizable lesson isn't "use exactly these four filters" — it's the design principle
itself: **independent, orthogonal sources of evidence reduce false positives more reliably than
tuning one signal harder.** A single signal, however well-tuned, is only ever answering one
question. Confluence design forces a trade to clear several different, ideally uncorrelated,
bars before it's taken.

**The tradeoff to teach alongside this:** every filter added also reduces trade frequency, and a
filter that's too restrictive (e.g. a positioning filter with a very short lookback) can end up
cutting trade count so far that there's no longer a statistically meaningful sample to trust the
result on. A filter should be validated to actually improve the outcome, not just added on the
assumption that "more confirmation is always better" — an unvalidated filter is scope creep, not
edge.

## A concrete example of validating one filter type generically

Testing a volatility-regime idea (comparing performance in the highest-volatility periods against
the rest) is a good template for how to validate any proposed filter: split history by the
candidate filter condition, compare the subset's performance against the unfiltered baseline
using the same metrics (profit factor, drawdown, trade count), and only adopt the filter if it
improves multiple metrics together — not just one, and not on a suspiciously small resulting
sample.
