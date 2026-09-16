# EVIDENCE RESULTS — in-sample, 2026-09-16

> **Re-run with a measured spread, 2026-09-16.** The operator supplied an MT5
> export (99,879 XAUUSD minute bars), giving a median spread of 10 points —
> 0.230 bps round trip, against the 2.5 bps this study assumed. The assumption
> was about eleven times too pessimistic. **The verdict does not change:** still
> 0 of 36 configurations beat buy-and-hold, and the best moved from +7.85% to
> +7.95% over twelve and a half years.
>
> That 0.10-point movement is the useful part. Total costs barely shifted, which
> means **spread was never the dominant cost here — financing is**, and
> financing is still assumed at 3%/yr because it comes from the symbol
> specification's swap rates, which have not been supplied. The measured number
> narrowed the uncertainty on the wrong term.

Run under `EVIDENCE_PROTOCOL.md`, committed before any backtest existed.

## Verdict

**The SMA-crossover strategy family failed in-sample on all three instruments.
No configuration was frozen, and the out-of-sample window was not touched.**

In-sample is the easy test — it is the data you are allowed to fit to. A rule
that cannot produce a defensible result there has nothing worth carrying to
out-of-sample, and running it anyway would spend a one-shot resource to confirm
something already known.

## What was run

36 configurations per instrument (fast ∈ {5,10,20} × slow ∈ {50,100,200} ×
ATR stop ∈ {2,3} × reward:risk ∈ {0,2}), 108 in total. Disclosed per protocol
§8.1, because with 36 attempts per instrument the best in-sample result is
substantially a draw from a distribution rather than a discovery.

Reproduce with `npm run evidence -- --sweep --symbol GCUSD`.

## Results

### GCUSD (gold) — clear failure

| | Return | Max DD | Trades |
|---|---|---|---|
| Best of 36 (20/50, atr 3, rr 0) | **+7.85%** | 3.5% | 32 |
| Buy and hold | **+57.79%** | 58.2% | 1 |

**0 of 36 configurations beat buy-and-hold** over 12.5 years. The strategy
delivered under an eighth of the return of doing nothing. It did so with far
less drawdown, which is worth noting and is not nearly enough: risk-adjusted
arguments do not rescue a 7.85% twelve-year return when the criterion is to
beat the alternative.

### BTCUSD — fails for a more instructive reason

| | Return | Max DD | Trades | Profit factor |
|---|---|---|---|---|
| Best of 36 (20/200, atr 2, rr 0) | **+585.77%** | 63.4% | **3** | 647.88 |
| Buy and hold | +571.68% | 89.9% | 1 |

Exactly one configuration of 36 beat buy-and-hold, by 14 percentage points,
**on three trades in six years**, with a profit factor of 648.

This is what a pre-registered criterion is for. Without criterion 1 (≥30
trades) this is a +586% strategy with a spectacular profit factor. With it, it
is three coin flips that happened to land during the largest bull market in the
asset's history. It also fails criterion 3 outright — a 63.4% drawdown against
a 20% limit — so it could not pass even if the trade count were ignored.

Cost note: $5,419 of costs on a $10,000 account, almost all financing. At 10%
annual on a position held for years, the carry alone is the dominant term.

### EURUSD — passes a broken criterion, fails on substance

| | Return | Max DD | Trades |
|---|---|---|---|
| Best of 36 (5/200, atr 3, rr 2) | **+2.70%** | 2.4% | 17 |
| Buy and hold | **−54.59%** | 60.7% | 1 |

All 36 configurations "beat" the baseline. That result is worthless, and finding
out why is the most useful thing this run produced — see below.

+2.70% over **twelve years**, on 17 trades, is indistinguishable from zero.

## Methodological findings

These matter more than the returns.

### 1. Criterion 2 is broken for FX, and I am not going to quietly fix it

Buy-and-hold on a currency pair is a pathological baseline. EURUSD fell from
~1.40 to ~1.12 across the window, and 3%/yr financing compounded over twelve
years does the rest — hence −54.59%. Nobody holds a currency pair as an
investment, so "beat buy-and-hold" is trivially satisfiable and measures
nothing. Every one of the 36 configurations cleared it, including ones that lost
money.

For FX the honest baseline is **cash** (0%, or the risk-free rate), not
buy-and-hold. I am recording this rather than editing the protocol silently: the
protocol was pre-registered, this flaw was found in-sample before out-of-sample
was touched, and in-sample is exactly where you are permitted to discover your
setup is wrong. Any future FX test should use a cash baseline, and that change
must be committed before the run it applies to.

### 2. Criterion 1 did the heavy lifting

The minimum trade count eliminated the only result that would otherwise have
looked spectacular. A 3-trade sample has no statistics in it. This is the
criterion most likely to be argued away later, and the one most worth keeping.

### 3. The strategy family is structurally unable to satisfy its own test

A 200-period slow average on daily bars produces 2-4 crossovers per instrument
per decade. The out-of-sample window is 6.7 years. Such a configuration
**cannot reach 30 trades**, whatever it does. Fast configurations (5/50) reach
the trade count but trade a coin flip after costs, at a profit factor near 1.

That is not a tuning problem. Daily-bar moving-average crossover on three
liquid instruments is among the most heavily mined ideas in the retail space,
and finding no edge in it is the expected outcome, not a surprise.

### 4. Financing dominated, exactly where the engine was previously blind

The simulator had no financing model until this session. On BTCUSD it is the
largest single cost; on the twelve-year EURUSD baseline it is most of the −54%.
Every result produced before that gap was closed would have been optimistic.

## What was NOT done, deliberately

- **No out-of-sample run.** Nothing earned one. The window remains untouched and
  usable for the first hypothesis that survives in-sample.
- **No tuning to pass.** The grid was fixed before the run and no configuration
  was added after seeing results. Extending it until something cleared 30 trades
  and a 1.2 profit factor would produce a number, not evidence.
- **No forward paper trading.** Nothing has qualified for it.

## Honest assessment

The infrastructure works and is well tested: no-look-ahead is structurally
enforced, costs are modelled including financing, the criteria are evaluated
mechanically, and the pipeline found a negative result and reported it rather
than being talked into a positive one. That is the machine doing its job.

The strategy does not work. The next step is a better hypothesis, not a better
fit — and the constraint that shapes it is the data: **daily bars only**, since
every intraday tier is denied on the current FMP plan. A genuine edge is more
plausible in places this data cannot reach (intraday behaviour, session effects,
microstructure) or in places it can but this strategy does not look
(cross-sectional relationships, carry, volatility regimes).

That decision needs the operator's input on cost and instrument reality before
it is worth making, because it changes which hypotheses are affordable.
