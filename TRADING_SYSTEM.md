# TRADING SYSTEM — state of play

Everything built for the unattended trading system, what two studies found, and
what would actually move it forward. Start here.

**Status: the infrastructure works and is well tested. No strategy has earned
the right to trade. Live mode is not enabled and cannot enable itself.**

## Run it

```bash
npm run backtest      # single-symbol engine, seeded synthetic data or --csv
npm run evidence      # hypothesis 1 (moving-average crossover)
npm run research      # hypothesis 2 (time-series momentum)
npm run unattended    # the live loop, driven through a failure gauntlet
npm run import-mt5    # import your broker's own history + measured spread
npm test              # 395 tests
```

## The four domains

| Domain | Responsibility |
|---|---|
| `simulator/` | Backtest engine. No look-ahead, costs including financing, metrics |
| `execution/` | Idempotent submission, ambiguous-send resolution, restart reconciliation |
| `riskcontrol/` | Independent preflight gate. Eleven limits, fails closed |
| `trader/` | The unattended cycle, kill switch, decision log, dashboard |
| `research/` | Multi-instrument portfolio backtesting, statistics, MT5 import |

## Invariants

These are enforced by types and tests, not by discipline.

1. **An AI can only ever produce a `Signal`.** A `Signal` has no `quantity`
   field, so no model output can express a position size. Only the Risk Manager
   sizes anything. `parseSignal()` pins the symbol to the one requested, assigns
   provenance from the caller rather than the payload, drops invented fields,
   and degrades to `hold` on anything malformed.
2. **No look-ahead, structurally.** A strategy sees a frozen slice of bars
   `0..i`; orders fill at bar `i+1`'s open. The general form is pinned by a
   test: *appending a future bar must not change any earlier return.*
3. **No duplicate orders.** Client order ids hash the decision, not the send.
   Resolution separates "the broker says no such order" from "the broker isn't
   answering". Conflating those is the bug that doubles positions.
4. **Two independent risk layers.** The Risk Manager sizes; the preflight gate
   evaluates against limits it owns exclusively. No shared code or config.
5. **Halts stop entries, never exits.** A gate that can trap you in a losing
   position is worse than no gate.
6. **Risk limits are outside the AI's reach.** The policy is frozen data and the
   domain exports no setter. Asserted against the real module namespace.
7. **Live mode is off.** `runBacktest` throws on any adapter declaring
   `isLive`; `runCycle` refuses a live gateway unless explicitly opted in, and
   nothing sets that opt-in. No venue adapter exists.

## Two studies, two falsifications

Both pre-registered — criteria and hypothesis committed **before** the data was
fetched, which the commit history shows.

| | Hypothesis | Result |
|---|---|---|
| 1 | Moving-average crossover | **Failed.** 0/36 configs beat buy-and-hold on gold; the one BTC "winner" was 3 trades |
| 2 | Time-series momentum | **Failed.** Raw signal hit rate 50.9% over 1,882 instrument-periods |

**The out-of-sample window has never been touched.** Neither hypothesis earned
a run at it. That is the protocol working, not a gap.

### The number that matters most

Hypothesis 2's signal predicted the next period's direction **50.9%** of the
time, against a standard error of 1.15%. That is 0.8 standard errors from a coin
flip, measured *before* portfolio construction, sizing or costs. There was no
edge to lose.

### What the studies taught that the returns did not

- **A pathological baseline can hide everything.** Buy-and-hold on a currency
  pair loses 54.6% over twelve years, so "beats buy-and-hold" was cleared by all
  36 configurations, *including ones that lost money*. Fixed to a cash baseline.
- **Minimum sample size does real work.** Without the ≥30 trade criterion, study
  1 reports a +586% strategy with a profit factor of 648. It was three trades.
- **Modelling costs finds bugs.** A 522% cost drag exposed a specification error
  producing 11x leverage on a supposed 10% vol target. A backtest without a
  financing model would have shown a plausible loss and hidden the cause.
- **Monotonic parameter sweeps are a warning.** Study 2's lookback sweep had no
  peak — a clean gradient is the signature of a cost function, not a signal. Had
  the parameters been searched rather than fixed, the shortest would have been
  picked and the monotonicity would have been invisible.

## The binding constraint is data, not ideas

Stated plainly, because it determines what is worth doing next.

- **No bonds, energy or agriculturals.** The data plan denies them. These are
  where trend following has historically worked best, so hypothesis 2 could not
  be tested on the universe its evidence rests on.
- **No intraday.** Every tier is denied. Session effects and microstructure —
  where an edge is most plausible for a small operator — are unreachable.
- **Spot prices, not total returns.** Carry and roll are excluded. For FX that
  is most of the historical return, so I tested price momentum with the paid
  component stripped out.
- **Costs are assumed, not measured.** After two studies, spread and swap are
  still my estimates.

## What would actually move this forward

In order of expected value:

### 1. Export your MT5 history (largest single win, costs nothing)

In MT5: **View → Symbols →** pick your symbol **→ Bars tab → Export**. Daily
(D1), as far back as it offers. Then:

```bash
npm run import-mt5 -- --file XAUUSD_Daily.csv --symbol XAUUSD --point 0.01
```

This is worth more than a data subscription, for one reason: MT5 exports carry a
`<SPREAD>` column. That is your broker's **measured** cost, per bar — the figure
both studies had to guess. The prices are your broker's own too, so a backtest
runs against quotes that would genuinely have been available to you.

The importer reports median, mean, p95 and max spread, and converts to basis
points given the point size. Use the median, not the mean: spread distributions
have a long right tail and the mean reports a cost you rarely pay.

### 2. The symbol specification

Right-click the symbol → **Specification**. Contract size, min/max/step volume,
margin per lot, swap long/short, commission. Not credentials — public instrument
config, safe to paste.

Without it, position sizing in lots and the margin model cannot be right, and
every result stays conditional.

### 3. Broader data

Bonds and commodities would let hypothesis 2 be tested properly. Intraday would
open hypotheses that daily bars cannot reach at all.

## Known limitations, recorded rather than buried

- **The cost model charges financing on gross exposure but never credits
  interest on cash.** A one-sided drag that would not exist in a real account
  earning a cash rate. Flagged deliberately rather than fixed mid-study —
  changing a cost assumption right after it produced an unwelcome result is how
  a backtest gets talked into working. It should be fixed before the next test,
  and any re-run reported as a re-run. It did not change either verdict.
- **No margin model.** Fine for cash instruments, wrong for leveraged CFDs.
- **No partial fills or liquidity model in the simulator.** Every order fills in
  full at one price.
- **Daily bars have no intrabar path**, so a bar containing both stop and target
  is resolved as the stop.
- **Effective breadth was 5.4**, not 12. Seven USD-driven FX pairs are not seven
  bets.

## Going live

A live runner is a **separate application** that imports these domains.
`PRODUCT_SPEC.md` declares "no real trades, no broker fund movement, no live risk
of any kind" a permanent non-goal for Trading School, so it does not belong
inside this app. That placement decision is still open.

Before any venue adapter exists, these are prerequisites, not nice-to-haves:

- Credentials in environment variables on the machine that runs the loop, held
  by a person. Never in this repository, never in an agent session.
- A margin model, if the instrument is leveraged.
- A kill switch that survives a restart — the current one is in memory.
- An audit trail through `app/lib/audit.ts`.
- A forward paper period against the real account that meets criteria agreed in
  advance.

**Live mode is enabled by a person, deliberately, once.** Nothing in this system
can promote itself past that line, and that is on purpose.
