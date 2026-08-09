# Risk Management: Adaptive Position Sizing & Guardrails

> DRAFT — extracted from internal research notes (`PROJECT_NOTES.md`) and generalized to strip
> any specific strategy's tuned numbers. This describes *principles*, not a specific validated
> configuration. Needs your review before being treated as confirmed methodology.

## The base position-sizing formula

A standard, non-proprietary way to size a position from a risk percentage:

```
position_size = (account_equity × risk_percent) / stop_distance
```

You decide how much of your account you're willing to lose on this trade (`risk_percent`), find
your stop distance from the entry, and the formula tells you how large a position keeps that
loss-if-stopped-out equal to your risk budget — regardless of account size. This is why the same
rule set can be described once and applied to a $500 account or a $500,000 one: the dollar risk
scales automatically, only the risk *percentage* needs deciding.

## Adaptive risk sizing: don't run the same risk % after a loss streak as after a win streak

Rather than a flat risk percentage on every trade, adaptive sizing adjusts the risk percentage
based on recent performance:

- **Cut risk after a loss streak or a drawdown from equity peak.** The idea: after evidence
  things aren't working right now (whether that's genuine edge decay or just a normal losing
  streak), trade smaller until the picture is clearer.
- **Only raise risk again after the account proves a new equity high** — i.e., raises are earned
  by real, realized performance, not by "it's been a while since a loss so we're due."

**Why this matters, not just what it does:** internal testing comparing adaptive risk against a
flat-risk baseline (same strategy, same signals, only the risk-sizing behavior different) found
this improved *both* returns and drawdown at the same time — not a tradeoff where you gain one at
the cost of the other. That's a stronger result than adaptive sizing merely "feeling" safer.

**A caution that belongs in the same lesson:** when tuning *how aggressively* to cut risk, pushing
the cut multiplier further and further kept "improving" the backtest all the way to the tested
parameter's boundary. Landing exactly on a boundary while a metric keeps monotonically improving
is a classic overfitting red flag, not a reason to be more confident — see the companion doc on
backtesting discipline. The lesson here: validate that adaptive sizing helps as a *category* of
technique, but don't chase the single most extreme cut/raise setting the backtest can find.

## Guardrails as a separate layer from sizing

Distinct from position sizing, account-level guardrails cap total risk regardless of what any
single trade's math says:

- **Daily loss cap** — stop trading for the day once cumulative losses hit a threshold.
- **Max trades per day** — caps overtrading, especially relevant on faster timeframes where a
  losing streak can compound quickly in a single session.

These exist specifically because per-trade risk sizing alone doesn't protect against a bad *day*
— several correctly-sized losing trades in a row can still add up to more than you'd want to lose
before stepping away. Worth teaching as a distinct concept from position sizing, not a restatement
of it.
