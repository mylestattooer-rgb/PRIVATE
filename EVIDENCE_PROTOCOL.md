# EVIDENCE PROTOCOL — pre-registered 2026-09-16

This document was written and committed **before any backtest was run**. It fixes
the rules in advance so that the results reported later cannot be graded against
criteria invented to fit them.

Commit `HEAD` at the time of writing contains the data (`data/*.csv`) and this
protocol, and no strategy results of any kind.

## 1. Why pre-register

The person who designs a strategy, chooses its parameters, runs the test, and
then decides what counts as success will conclude that it succeeded. That is not
dishonesty, it is how the exercise works if the criteria are chosen afterwards.
Fixing them first is the only cheap defence.

## 2. Data

| Instrument | Bars | Range | Source |
|---|---|---|---|
| EURUSD | 5000 | 2007-09-26 → 2026-09-16 | FMP `forex-historical-price-eod-full` |
| GCUSD (COMEX gold) | 5000 | 2007-06-22 → 2026-09-16 | FMP `commodities-historical-price-eod-full` |
| BTCUSD | 4642 | 2014-01-01 → 2026-09-16 | FMP `cryptocurrency-historical-price-eod-full` |

Daily bars only — the FMP plan in use denies every intraday tier. Every bar was
validated on import (`high >= max(open, close)`, `low <= min(open, close)`, all
prices positive and finite, strictly increasing dates); **zero** bars were
dropped from any series. The CSVs are committed so every number below is
reproducible from this repository alone.

Known limitations of this data, stated now rather than when they become
inconvenient:

- **5000-row cap.** FMP returns at most 5000 bars per call, so EURUSD and GCUSD
  start in 2007 rather than 2005. Not a problem for the split below, but it
  means the 2008 crisis sits near the very start of the in-sample window.
- **GCUSD is COMEX futures**, not spot XAUUSD and not any broker's gold CFD.
  Prices track closely; costs do not. Results transfer only as far as the cost
  assumptions in §4 do.
- **BTCUSD early volume is reported as 0** for part of 2014-2015. No strategy
  here uses volume, so this is recorded but not consequential.
- Daily bars have **no intrabar path**. Stop and target resolution sees only
  OHLC, so a bar containing both is resolved as the stop (see §5).

## 3. Split

**In-sample: series start → 2019-12-31. Out-of-sample: 2020-01-01 → 2026-09-16.**

The out-of-sample window is not read, plotted, summarised, or tested against
until a configuration is frozen. It deliberately contains the COVID crash, the
2021-22 inflation shock, and the rate cycle — regimes absent from in-sample.

## 4. Cost assumptions — ASSUMED, NOT MEASURED

**This is the weakest part of this protocol and the most likely reason a
conclusion here would not survive contact with a real account.** The operator's
broker and instrument specification were not available, so the figures below are
my estimates of typical retail MT5 CFD terms, chosen on the pessimistic side.
Every one is a parameter, and all results must be re-run when real values exist.

| Instrument | Half-spread (bps) | Commission per side (bps) | Financing (%/yr) |
|---|---|---|---|
| EURUSD | 0.75 | 0.5 | 3.0 |
| GCUSD | 1.25 | 0.5 | 3.0 |
| BTCUSD | 5.0 | 1.0 | 10.0 |

Applied as: half-spread paid on entry and on exit, commission on both sides, and
financing charged daily on open position notional. Financing is charged to long
and short alike, which is pessimistic for shorts and roughly right for a retail
CFD account where both sides usually pay.

## 5. Execution assumptions

Inherited from `app/lib/domains/simulator/`, which enforces them structurally:

- A strategy deciding on bar `i` sees a frozen copy of bars `0..i` only.
- Orders fill at bar `i+1`'s **open**, never the close they were decided from.
- Resting stops fill at the stop price, or at the open when the bar gapped
  through it — whichever is worse.
- A bar containing both stop and target is resolved **as the stop**.
- Positions open at the end of data are closed at the final close.

## 6. Baseline

**Buy and hold** the same instrument over the same out-of-sample window, paying
the same entry/exit costs and the same daily financing on the same notional.

A strategy that does not beat buying the thing and doing nothing has not earned
the operational risk of an unattended system, whatever its Sharpe ratio.

## 7. Pass/fail criteria — all six required

Evaluated on the **out-of-sample window only**.

| # | Criterion | Threshold |
|---|---|---|
| 1 | Closed trades | **≥ 30** |
| 2 | Net return after all costs | **> baseline net return** |
| 3 | Maximum drawdown | **≤ 20%** |
| 4 | Profit factor | **≥ 1.2** |
| 5 | Total costs as a share of gross profit | **≤ 30%** |
| 6 | Robustness: net return with the single best trade removed | **still > 0** |

**Any single failure is a FAIL**, and will be reported as a fail. There is no
partial credit and no "promising, needs tuning".

Criterion 1 exists because a strategy with nine trades has no statistics, only
anecdotes. Criterion 6 exists because one lucky trade can carry an entire curve.

## 8. Protocol rules

1. In-sample exploration is unlimited. **The number of configurations evaluated
   in-sample will be disclosed with the results** — it is the single most
   important number for judging whether an in-sample result is real.
2. **Exactly one** out-of-sample run, on exactly one frozen configuration per
   instrument. The freeze is a commit, made before the run.
3. **No parameter changes after seeing out-of-sample results.** If it fails, it
   fails. Any revised strategy tested afterwards is reported with the explicit
   caveat that the out-of-sample set is now contaminated and no longer
   out-of-sample for that purpose.
4. A passing result is **not** a claim of profitability. It means the strategy
   was not eliminated by this particular test, on this data, under these assumed
   costs. The next step after a pass is forward paper trading, not money.

## 9. What a pass would and would not establish

Would: the rule survived a period it was not fitted to, beat doing nothing, and
did not depend on a single trade.

Would not: that the edge persists, that the assumed costs match a real account,
that daily-bar fills are achievable, or that the operator's broker behaves like
this model. Those are answered by forward paper trading against the real
account, which is step 4's second half and has not been run.
