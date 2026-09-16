# EVIDENCE RESULTS 2 — in-sample, 2026-09-16

Run under `EVIDENCE_PROTOCOL_2.md`, committed before any of this was tested.

## Verdict

**Hypothesis 2 is falsified on this data. Four of five predictions fail. The
out-of-sample window was not touched.**

But the decisive number is not any of the returns. It is this:

> **Raw signal hit rate: 50.9%** over 1,882 instrument-periods.

The sign of the trailing 12-month return predicted the sign of the next month's
return 50.9% of the time. With n = 1,882 the standard error is 1.15%, so that is
**0.8 standard errors from a coin flip** (two-sided p ≈ 0.43).

This matters because it is measured *before* portfolio construction, sizing,
costs, or any implementation choice of mine. **There is no edge here to lose.**
Everything downstream is noise being shaped.

## Headline numbers (in-sample, 2008-06 → 2019-12, 3,767 bars)

| | Return/yr | Vol | Sharpe | Max DD |
|---|---|---|---|---|
| TSMOM (net) | **−2.21%** | 4.4% | **−0.506** | 29.9% |
| TSMOM (gross, no costs) | +0.68% | 4.4% | **0.157** | 13.0% |
| Long-only, same sizing | −1.20% | 3.5% | −0.339 | 22.4% |
| Cash | 0.00% | — | — | 0% |

A gross Sharpe of 0.157 is exactly what a 50.9% hit rate should produce: barely
distinguishable from zero. Costs then take it firmly negative.

## Predictions

| | Prediction | Result | |
|---|---|---|---|
| P1 | Basket beats mean single-instrument Sharpe | **FAILS** | −0.506 vs −0.230 |
| P2 | Majority of instruments positive | HOLDS | 8/12 |
| P3 | Not explained by long-only beta | **FAILS** | −0.506 vs −0.339 |
| P4 | Weaker in the later half | **FAILS** | −0.712 then −0.333 |
| P5 | Survives costs | **FAILS** | +0.68% gross → −2.21% net |

**P1 is the most damaging.** The entire claimed mechanism is that the effect
lives in the diversified basket. The basket did *worse* than the average of its
own members. That is a direct falsification of the stated mechanism, not a
disappointing return.

**P2 holding is not encouraging.** 8 of 12 positive with a pooled hit rate of
50.9% is what you get from twelve draws around zero. It is the weakest of the
five predictions and the only one that passed.

**P4 failed in the "suspicious" direction** — the later period was *less bad*
(−0.333 vs −0.712). I called a stronger recent period grounds for suspicion, and
I will not now argue my way out of it. The mitigating fact is that both halves
are losses, so this is not a fitted result looking good recently; it is one kind
of bad followed by a slightly milder kind.

## Robustness sweep (post-hoc)

| Lookback | Return/yr | Sharpe |
|---|---|---|
| 63d | −0.14% | −0.031 |
| 126d | −1.11% | −0.252 |
| 189d | −1.66% | −0.374 |
| **252d (headline)** | **−2.21%** | **−0.506** |
| 315d | −2.33% | −0.542 |
| 378d | −3.05% | −0.707 |

**Monotonic, with no peak.** This is diagnostic. A real effect usually shows a
plateau — a range of parameters that all work, because the underlying phenomenon
has a characteristic timescale. A clean monotonic gradient with no optimum is
the signature of a cost-and-staleness function, not a signal. Shorter lookbacks
are less bad simply because they are less wrong for longer.

Had I searched instead of pre-registering, I would have picked 63d, reported
"roughly flat, needs work", and carried on. The pre-registration is what makes
the monotonicity visible as evidence rather than invisible as a tuning step.

## An implementation error worth recording

The first run of this study reported −32.67%/yr with **11.3x mean gross
exposure** and a **522% cost drag** on a strategy whose stated target was 10%
volatility.

The cause was a specification error, not a coding one: I scaled each of twelve
instruments to a 10% volatility target and then *summed* them, with no `1/N`
normalisation. Twelve instruments each sized for 10% vol is not a 10% vol
portfolio; it is roughly twelve times the intended exposure.

Two things are worth taking from this:

1. **The cost model caught it.** A backtest without financing would have shown a
   plausible-looking loss and hidden the cause completely. The 522% drag was
   absurd on its face, which is what made it findable. Modelling costs properly
   pays for itself in diagnosis long before it pays for itself in accuracy.
2. **It is recorded, not quietly corrected.** The fix is normalisation to the
   standard construction, and there is now a test pinning it: one instrument and
   four identical ones must run at the same gross leverage.

## Why this is not a refutation of time-series momentum

Stating this plainly because the honest conclusion is narrower than the result
looks.

**The test is weak, for four identifiable reasons:**

1. **The universe is wrong for the hypothesis.** Published TSMOM evidence rests
   on a basket spanning bonds, energy, agriculturals, metals, equities and FX —
   typically ~50+ futures. Bonds and commodities are where trend following has
   historically worked best, and **this data plan denies all of them.** What
   remains is seven USD-driven FX pairs, three futures and two crypto.
2. **Measured effective breadth is 5.4 independent bets**, not 12. The mean
   absolute pairwise correlation is 0.111 — better than I expected, but the
   count still overstates the diversification by more than half.
3. **Spot price series exclude carry, and for FX that is most of the return.**
   The published strategy trades futures, whose returns include the roll. A long
   AUDUSD position historically earned interest-rate carry that simply is not in
   a spot price series. I am testing price momentum with the carry stripped out,
   which is not the strategy the literature describes.
4. **The period is a known-poor one.** 2008-2019 is the post-crisis,
   central-bank-dominated, low-volatility regime that the trend-following
   industry itself reports as its worst stretch.

**The correct conclusion is not "TSMOM does not work."** It is: *this data cannot
test TSMOM properly, and what it can test shows nothing.* Those are different
claims and only the second is supported.

## A cost-model limitation found along the way

The model charges financing on gross exposure but **never credits interest on
unencumbered cash.** For a vol-targeted strategy running ~1x gross with most
capital sitting as collateral, that is a systematic one-sided drag that would
not exist in a real account earning a cash rate.

I am flagging it rather than fixing it here, deliberately: changing a cost
assumption immediately after it produced an unwelcome result is how a backtest
gets talked into working. It should be fixed before the *next* test, and any
re-run of this one must be reported as a re-run.

**It does not change this verdict.** The strategy fails on gross returns, with a
0.157 Sharpe and a coin-flip hit rate, before any cost treatment at all.

## What was not done

- **No out-of-sample run.** Nothing earned one. The window is still untouched
  after two hypotheses, which is the point of protecting it.
- **No parameter search.** The specification was fixed in advance and the sweep
  ran afterwards, as a diagnostic, and changed nothing.
- **No cost-model adjustment to rescue the result.**

## What would actually advance this

In order of expected value:

1. **Bonds and commodities data.** The single largest gap. The hypothesis is
   about a diversified futures basket and I cannot assemble one.
2. **Total-return series, not spot prices**, so carry and roll are included.
3. **The broker's real cost specification**, which remains unmeasured after two
   studies and gates any conclusion about implementability.
4. **Intraday data**, for hypotheses that daily bars cannot reach at all.

Two hypotheses tested, two falsified, out-of-sample intact. The infrastructure
did its job both times: it found the answer, showed its working, and caught its
own implementation bug on the way.
