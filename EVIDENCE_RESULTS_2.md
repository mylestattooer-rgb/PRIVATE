# EVIDENCE RESULTS 2 — in-sample, 2026-09-16

Run under `EVIDENCE_PROTOCOL_2.md`, committed before any of this was tested.

> **This document was corrected after publication.** The first version reported
> numbers produced with a calendar bug found in adversarial code review. The bug,
> what it changed, and what it invalidated are in §6. The verdict is unchanged;
> two of the supporting arguments were wrong and are retracted.

## 1. Verdict

**Hypothesis 2 is falsified on this data. Three of five predictions fail,
including both that carry the mechanism. The out-of-sample window was not
touched.**

The decisive number is not a return:

> **Raw signal hit rate: 48.3%** over 1,371 instrument-periods.

The sign of the trailing 12-month return predicted the sign of the next month's
return 48.3% of the time — slightly *worse* than a coin flip. With n = 1,371 the
standard error is 1.35%, so this is 1.3 standard errors below 50% (p ≈ 0.21):
not significantly negative either, just noise.

This is measured *before* portfolio construction, sizing or costs. **There is no
edge here to lose.** Everything downstream is noise being shaped.

## 2. Headline numbers (in-sample, 2008-10 → 2019-12, 3,683 bars)

| | Return/yr | Vol | Sharpe | Max DD |
|---|---|---|---|---|
| TSMOM (net) | **−3.68%** | 4.3% | **−0.855** | 33.9% |
| TSMOM (gross, no costs) | **−0.38%** | 4.3% | **−0.089** | 10.9% |
| Long-only, same sizing | −1.27% | 3.5% | −0.367 | 19.7% |
| Cash | 0.00% | — | — | 0% |

**It loses before costs.** A gross Sharpe of −0.089 on a 48.3% hit rate is
internally consistent and settles the question: cost assumptions are not what
killed this.

## 3. Predictions

| | Prediction | Result | |
|---|---|---|---|
| P1 | Basket beats mean single-instrument Sharpe | **FAILS** | −0.855 vs −0.361 |
| P2 | Majority of instruments positive | HOLDS | 6/12 |
| P3 | Not explained by long-only beta | **FAILS** | −0.855 vs −0.367 |
| P4 | Weaker in the later half | HOLDS | −0.819 then −0.890 |
| P5 | Survives costs | **FAILS** | −0.38% gross → −3.68% net |

**P1 is the most damaging.** The claimed mechanism is that the effect lives in
the diversified basket. The basket did markedly *worse* than the average of its
own members. That falsifies the mechanism, not merely the return.

**P2 holding is not support.** Exactly 6 of 12 positive, at a 48.3% hit rate, is
twelve draws around zero. It clears the threshold by definition and carries no
information.

**P4 held**, and unlike the pre-correction run it held in the honest direction:
the later half was worse. Both halves are losses, so this is one kind of bad
followed by a slightly worse kind, not a decayed edge.

## 4. Robustness sweep (post-hoc)

| Lookback | Return/yr | Sharpe |
|---|---|---|
| 3mo | −1.50% | −0.334 |
| 6mo | −0.83% | −0.188 |
| 9mo | −2.48% | −0.573 |
| **12mo (headline)** | **−3.68%** | **−0.855** |
| 15mo | −2.87% | −0.702 |
| 18mo | −1.37% | −0.325 |

Every horizon loses. There is no ordering to it — 6mo is least bad, 12mo worst,
18mo middling — which is what a sweep over noise looks like.

## 5. Concentration

Largest contributor BTCUSD at +4.62%. Removing it makes the result **worse**
(−4.42%/yr, Sharpe −0.967). There is no single instrument carrying this; it is
uniformly poor.

Measured effective breadth: **5.36 independent bets** from 12 instruments (mean
absolute pairwise correlation 0.113). The instrument count overstates the
diversification by more than half.

## 6. The correction: a calendar bug found in review

The first published version of this document reported a 50.9% hit rate,
−2.21%/yr net and **+0.68%/yr gross**. Those numbers were wrong.

**The bug.** `alignSeries` builds a union calendar, mixing 7-day crypto with
5-day FX. That calendar runs at **336.3 bars per year**, measured. Every
calculation assumed 252. Three consequences, all in the same direction of making
the study not test what it claimed:

1. The "canonical 12-month lookback" of 252 bars was really **9.0 months**.
2. Volatility was annualised by `sqrt(252)` instead of `sqrt(336)`, understating
   it by a factor of 0.866 — so a 10% volatility target actually ran about 15%
   hot.
3. Returns and Sharpe ratios were annualised on the wrong base.

**The fix.** `barsPerYear()` measures the calendar rather than assuming it, and
the specification is now expressed in **months**, with bar counts derived. A
12-month lookback is 336 bars on this data and 252 on a weekday-only calendar,
which is the point. Pinned by a test.

**What changed, honestly:**

| | Before (buggy) | After |
|---|---|---|
| Hit rate | 50.9% | **48.3%** |
| Gross return | +0.68%/yr | **−0.38%/yr** |
| Gross Sharpe | 0.157 | **−0.089** |
| Net return | −2.21%/yr | −3.68%/yr |
| P4 | FAILED | HOLDS |

**Two arguments I made are retracted:**

1. I wrote that the lookback sweep was *"monotonic, with no peak"* and called
   that "the signature of a cost-and-staleness function, not a signal". **That
   was an artefact of the bug.** The corrected sweep has no ordering at all. The
   reasoning was sound; the data under it was not, so the conclusion does not
   stand. It looks like noise because it is noise, not because of a cost
   gradient.
2. I wrote that the strategy "fails on gross returns" with a *positive* 0.157
   Sharpe, which was already a strained reading. Corrected, gross is negative
   and the claim is simply true.

**What did not change:** the verdict. The hypothesis is falsified either way,
and P1 — the mechanism test — fails more decisively after correction.

**Why this is in the document rather than a silent edit.** The point of
pre-registering is that the record survives contact with inconvenient facts.
A study that quietly restates its numbers is worth nothing, and a bug found by
review after publication is exactly the case the practice exists for.

## 7. An earlier implementation error, also recorded

Before the calendar bug, the very first run reported −32.67%/yr at **11.3x mean
gross exposure** with a **522% cost drag**, on a strategy targeting 10%
volatility.

Cause: twelve instruments each scaled to a 10% vol target, then *summed*, with no
`1/N` normalisation. Twelve instruments each sized for 10% vol is not a 10% vol
portfolio.

**The cost model caught it.** Without a financing charge the run would have shown
a plausible loss and hidden the cause entirely. A 522% drag is absurd on its
face, which is what made it findable. Modelling costs properly paid for itself in
diagnosis long before accuracy.

## 8. Why this is not a refutation of time-series momentum

The honest conclusion is narrower than the result looks. The test is weak for
four identifiable reasons:

1. **The universe is wrong for the hypothesis.** Published evidence rests on ~50+
   futures spanning bonds, energy, agriculturals, metals, equities and FX. Bonds
   and commodities — where trend following has historically worked best — are
   **denied on this data plan**. What remains is seven USD-driven FX pairs, three
   futures and two crypto.
2. **Effective breadth is 5.36**, not 12.
3. **Spot prices exclude carry and roll.** The published strategy trades futures,
   whose returns include the roll; a long AUDUSD position historically earned
   interest-rate carry that is simply not in a spot price series. This tests
   price momentum with the paid component stripped out.
4. **2008-2019 is a known-poor regime**, which the trend-following industry
   itself reports as its worst stretch.

**The supported claim is: this data cannot test the hypothesis properly, and
what it can test shows nothing.** Not "TSMOM does not work."

## 9. A cost-model limitation, flagged not fixed

The model charges financing on gross exposure but **never credits interest on
unencumbered cash** — a one-sided drag that would not exist in a real account
earning a cash rate.

Flagged deliberately rather than fixed: changing a cost assumption immediately
after it produces an unwelcome result is how a backtest gets talked into working.
It should be fixed before the next study, and any re-run reported as a re-run.

It does not change the verdict — the strategy loses before costs.

## 10. What was not done

- **No out-of-sample run.** Nothing earned one. The window is untouched after two
  hypotheses.
- **No parameter search.** The specification was fixed in advance; the sweep ran
  afterwards as a diagnostic and changed nothing.
- **No cost-model adjustment to rescue the result.**

## 11. What would advance this

1. **Bonds and commodities.** The largest gap; the hypothesis is about a
   diversified futures basket and one cannot be assembled here.
2. **Total-return series** including carry and roll.
3. **The broker's real cost specification**, still unmeasured after two studies.
   `npm run import-mt5` now extracts it directly from an MT5 export.
4. **Intraday data**, for hypotheses daily bars cannot reach.

Two hypotheses tested, two falsified, out-of-sample intact, and one published
result corrected after review found the bug behind it.
