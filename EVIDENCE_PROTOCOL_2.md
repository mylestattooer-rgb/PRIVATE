# EVIDENCE PROTOCOL 2 — pre-registered 2026-09-16

Second hypothesis, written and committed **before any of it was tested**.
Supersedes nothing in `EVIDENCE_PROTOCOL.md`; that run is closed and its result
stands (`EVIDENCE_RESULTS.md`: failed).

## 1. Why the first hypothesis failed, and what that implies

The moving-average crossover failed in-sample on all three instruments. Two
reasons, and only one of them is about the rule itself:

1. **It was a single-instrument bet.** 36 parameter variants on one symbol is a
   search over noise. The more parameters tried on one series, the more certain
   it is that the best result is luck.
2. **It had no stated reason to work.** "Fast average crosses slow average" is a
   pattern, not a mechanism. There was no prior claim about *why* the market
   would pay for it, so there was nothing to be surprised by when it did not.

The correction is not a better-tuned crossover. It is **breadth instead of
depth**: one specification, fixed in advance, evaluated across many instruments,
with an economic reason stated before the test.

## 2. Hypothesis H2 — time-series momentum

**Claim.** Across liquid, diversified instruments, the sign of an asset's own
trailing 12-month return predicts the sign of its next-period return, and a
volatility-scaled portfolio taking that position in every instrument earns a
positive risk-adjusted return after costs.

**Why it might be true.** Three candidate mechanisms, none of which requires
anyone to be stupid:

- **Slow information diffusion.** Large institutional flows are executed over
  weeks, not instantly. Price adjusts gradually, and the gradient is persistent.
- **Risk transfer.** In futures, hedgers pay speculators to carry price risk.
  A trend follower's payoff is long-volatility and crash-convergent — it loses
  small amounts often and wins during sustained dislocations — which is a shape
  most investors dislike and therefore pay to avoid holding.
- **Anchoring and disposition effects.** Investors under-react to news that
  contradicts a prior view and realise gains too early, both of which extend
  trends.

**Why this is a stronger prior than a crossover.** Time-series momentum is one
of the most replicated results in empirical finance — documented across asset
classes and across a century of data by multiple independent groups. Its
published effect lives in the **diversified portfolio**, not in any single
instrument, which also explains why testing it one symbol at a time would find
nothing.

**Honest counter-case, stated up front.** Published Sharpe ratios for this
family have declined materially since roughly 2010 as it was commercialised.
A large positive result on recent data would be surprising and should be treated
as suspicious rather than welcome.

## 3. Falsifiable predictions

These are the ways H2 can be wrong. Each is checked, and each failure is
reported.

| | Prediction | If false |
|---|---|---|
| **P1** | Basket Sharpe exceeds the *average* single-instrument Sharpe | Diversification is not the mechanism; the effect is one instrument in disguise |
| **P2** | A majority of instruments have positive standalone returns | The result rests on a few names and is not a general effect |
| **P3** | Returns are not explained by a long-only vol-targeted basket | It is beta, not momentum |
| **P4** | The effect is **weaker** post-2010 than pre-2010 | If stronger, suspect fitting or a data artefact |
| **P5** | Survives costs at the stated rebalance frequency | Not implementable |

**P4 is deliberately a prediction of weakness.** A hypothesis that can only be
confirmed is not a hypothesis.

## 4. Specification — FIXED, not searched

The single most important commitment in this document. **No grid search.** These
are the canonical published values, chosen before seeing any result:

| Parameter | Value | Why this value |
|---|---|---|
| Lookback | **252 trading days** | The canonical 12-month horizon |
| Signal | **sign of trailing return** | Binary long/short; no threshold to tune |
| Volatility estimate | **60-day realised, annualised** | Standard short-window estimator |
| Volatility target | **10% annualised per instrument** | Conventional; equalises risk contribution |
| Rebalance | **monthly (every 21 bars)** | Matches the published specification |
| Weighting | **equal risk, not equal capital** | Vol scaling is the point |

One robustness sweep over lookback is run **after** the headline result, to check
it is not a knife-edge. The headline number is the 252-day specification
regardless of whether another lookback looks better.

## 5. Universe

Twelve instruments, everything the data plan permits:

- **FX (7)**: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD
- **Futures (3)**: ESUSD (S&P 500), GCUSD (gold), SIUSD (silver)
- **Crypto (2)**: BTCUSD, ETHUSD

**This is a weak universe for this hypothesis, and that is a real limitation.**
The published evidence rests on a basket spanning equities, *bonds*, *energy*,
*agriculturals*, metals and FX. Bonds, energy and ags are all denied on this
data plan. What remains is dominated by seven USD-driven FX pairs which are
substantially one bet, not seven.

**Effective breadth will be measured and reported** from the correlation matrix,
not assumed from the instrument count.

## 6. Costs

As `EVIDENCE_PROTOCOL.md` §4 — still ASSUMED, not measured. Monthly rebalance
means far fewer transactions than the daily strategy, so cost sensitivity is
lower; that is a point in the hypothesis's favour and is not evidence for it.

## 7. Baselines

Two, because one is not enough to separate skill from exposure:

1. **Cash (0%)** — replaces buy-and-hold for FX, which
   `EVIDENCE_RESULTS.md` established is a pathological comparison.
2. **Long-only, vol-targeted, equal-risk basket** — the same portfolio
   construction with the momentum signal forced to +1. This is the P3 test and
   the one that matters: if the strategy cannot beat permanently-long, it is
   selling beta with extra steps.

## 8. Criteria

Evaluated **at the portfolio level**, out-of-sample, once.

| # | Criterion | Threshold |
|---|---|---|
| 1 | Annualised return after costs | > 0 |
| 2 | Sharpe ratio | ≥ 0.4 |
| 3 | Max drawdown | ≤ 25% |
| 4 | Beats the long-only basket on Sharpe | yes |
| 5 | Positive-return instruments | ≥ half the universe |
| 6 | Result survives removing the best instrument | still positive |

A Sharpe floor of 0.4 is deliberately modest. Published long-run figures for
diversified time-series momentum sit near 0.7–1.0 before fees on a far broader
universe; on twelve instruments dominated by correlated FX, and after the
post-2010 decay, 0.4 is the level below which this is not worth operating.

Criterion 6 is the analogue of protocol 1's best-trade test, which caught the
BTC result. Here the concentration risk is an instrument, not a trade.

## 9. Protocol rules

Unchanged from `EVIDENCE_PROTOCOL.md` §8: in-sample first, one out-of-sample
run on a frozen specification, no parameter changes after seeing out-of-sample,
and full disclosure of everything evaluated.

The split is the same: in-sample to 2019-12-31, out-of-sample 2020-01-01 onward.

## 10. What a pass would mean

That a specification fixed in advance, with a stated mechanism, survived a
period it was not fitted to, beat both doing nothing and being permanently long,
and did not rest on one instrument.

It would still not establish that the edge persists, that the costs are right,
or that a retail CFD account can access this at these prices. Those need the
broker specification and forward paper trading.
