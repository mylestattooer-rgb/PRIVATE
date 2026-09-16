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
npm run intraday      # what a strategy must achieve to cover this broker's spread
npm test              # 451 tests
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

## A screen, before the third hypothesis

`INTRADAY_FEASIBILITY.md` asks what hit rate a strategy would need merely to
cover this broker's measured spread, hour by hour. It measures no returns and
proposes no strategy; it exists to close off search space before a hypothesis
is written, and it is deliberately optimistic so that the cells it *closes* are
soundly closed.

- **Gold is not excluded anywhere.** At horizons of 15 minutes or more it needs
  50.6%–53.6% depending on the hour. At one minute, 52.5% at best.
- **AUDCAD mostly is.** Nine of ninety-six cells are affordable.
- **One hard exclusion.** At 21:00 UTC — 00:00 on this GMT+3 server, the daily
  rollover — AUDCAD's spread is **38× its normal level**, sustained across every
  ten-minute block of the hour. Break-even needs **491% at one minute and 122%
  at one hour**. A probability cannot exceed 1, so nothing of any quality trades
  AUDCAD in that hour. It binds on strategies that *transact* then, not on
  positions merely held through it.

## Two studies, two falsifications

Both pre-registered — criteria and hypothesis committed **before** the data was
fetched, which the commit history shows.

| | Hypothesis | Result |
|---|---|---|
| 1 | Moving-average crossover | **Failed.** 0/36 configs beat buy-and-hold on gold; the one BTC "winner" was 3 trades |
| 2 | Time-series momentum | **Failed.** Raw signal hit rate 48.3% over 1,371 instrument-periods |

**The out-of-sample window has never been touched.** Neither hypothesis earned
a run at it. That is the protocol working, not a gap.

### The number that matters most

Hypothesis 2's signal predicted the next period's direction **48.3%** of the
time — worse than a coin flip — against a standard error of 1.35%. That is 1.3
standard errors *below* 50%, so it is not significantly negative either: it is
noise. It is measured *before* portfolio construction, sizing or costs, which
settles the question of whether cost assumptions killed it. **There was no edge
to lose.**

Study 1's corrected verdict is the milder kind of failure. The best gold
configuration beats cash by about **0.58% a year** over twelve and a half
years — not a loss, and not remotely a reason to run an unattended system that
carries drawdown, execution and operational risk a deposit does not. Over the
same window, owning gold outright returned roughly **+130%**.

### What the studies taught that the returns did not

- **A pathological baseline can hide everything.** Buy-and-hold on a currency
  pair loses 54.6% over twelve years, so "beats buy-and-hold" was cleared by all
  36 configurations, *including ones that lost money*. Fixed to a cash baseline.
- **Minimum sample size does real work.** Without the ≥30 trade criterion, study
  1 reports a +586% strategy with a profit factor of 648. It was three trades.
- **Modelling costs finds bugs.** A 522% cost drag exposed a specification error
  producing 11x leverage on a supposed 10% vol target. A backtest without a
  financing model would have shown a plausible loss and hidden the cause.
- **Measure the calendar, don't assume it.** Mixing 7-day crypto with 5-day FX
  produces a union calendar running at **336 bars/year**. Every annualisation
  assumed 252, so study 2's "12-month lookback" was really 9 months and its 10%
  volatility target ran about 15% hot. Adversarial review found it *after*
  publication; 395 tests had not. `EVIDENCE_RESULTS_2.md` §6 is corrected in
  place, with two arguments retracted rather than quietly restated.
- **A one-sided cost model is a rigged comparison.** Charging financing on
  borrowed money while crediting nothing on idle cash penalises a strategy that
  is flat most of the time. Worth ~48% of starting capital over study 1's
  window — four times the strategy's entire modelled return. It produced a
  dramatic and wrong conclusion, since retracted. Corrected, the rule fails for
  the ordinary reason: it is barely distinguishable from doing nothing.

## The binding constraint is data, not ideas

Stated plainly, because it determines what is worth doing next.

- **No bonds, energy or agriculturals.** The data plan denies them. These are
  where trend following has historically worked best, so hypothesis 2 could not
  be tested on the universe its evidence rests on.
- **~~No intraday.~~ Wrong, and corrected.** Every FMP tier is denied, and I
  wrote that down as if it settled the question. It did not: the operator's own
  MT5 exports are **99,879 minute bars each**, with the broker's per-bar spread
  attached. I had mistaken a limitation of one source for a limitation of the
  problem, which quietly removed the most promising direction from
  consideration. What the exports genuinely lack is *length* — about three
  months each, one regime. That is too short to test a signal and ample to
  measure a cost. See `INTRADAY_FEASIBILITY.md`.
- **Spot prices, not total returns.** Carry and roll are excluded. For FX that
  is most of the historical return, so I tested price momentum with the paid
  component stripped out.
- **Spread is now measured; swap is assumed and no longer worth collecting.**
  The operator's MT5 export puts gold's round-trip spread at **0.230 bps**
  against the 2.5 bps assumed — eleven times too pessimistic, and it moved the
  verdict by 0.10 points. Swap remains an assumption at 3%/yr, and
  `--swap-sweep` shows that no value in or beyond the plausible range changes
  either verdict. The ask for it is withdrawn.

## Already settled — nothing needed from the operator

Both of the asks that used to head this section are closed.

- **MT5 history: supplied and imported.** AUDCAD and XAUUSD, 99,879 minute bars
  each. `npm run import-mt5` aggregates them to daily and reads the `<SPREAD>`
  column for the broker's real per-bar cost. The first real file immediately
  caught an importer bug — it had been writing 99,879 rows across 70 dates,
  silently meaningless rather than obviously broken.
- **The COMEX proxy is validated**, so the broker's short history is not a
  constraint. Correlation between the broker's XAUUSD and FMP's GCUSD rises with
  horizon — 0.84 at one day, **0.99 at 20–40 days**. Lagging one series made it
  collapse, so the daily gap is venue noise, not a clock offset. The 19 years of
  GCUSD already committed can stand in for the broker's instrument at momentum
  horizons.
- **The symbol specification is no longer needed** for the swap rate.
  `--swap-sweep` settled it without measuring it: see the note at the top of
  `EVIDENCE_RESULTS.md`. It is still the only source for a per-instrument margin
  requirement, which the funding-model limitation below depends on — but that
  limitation moves no verdict.

## What would actually move this forward

In order of expected value. All three are data or ideas, not operator actions.

### 1. Bonds and commodities

The largest single gap. Hypothesis 2 is a claim about a diversified futures
basket spanning ~50 instruments, and the current plan denies bonds, energy and
agriculturals — precisely where trend following has historically worked best.
What remains is seven USD-driven FX pairs, three futures and two crypto, with a
measured effective breadth of 5.36. **The supported claim is that this data
cannot test the hypothesis, not that the hypothesis is false.**

### 2. Longer intraday history

Not intraday data as such — that arrived with the MT5 exports. **Length.** Three
months is one regime, so the feasibility screen below can say what trading cost
over this window and not whether that holds. A year or more of M1, or repeated
exports over time, would turn a snapshot into something with a trend in it.

### 3. A better hypothesis, not a better fit

Two of the most heavily mined ideas in the retail space have now been tested and
rejected on schedule. Extending either grid until something passed would produce
a number, not evidence. The honest next move is a hypothesis with a stated
mechanism that this data can actually test — carry, volatility regimes, or
cross-sectional relationships — pre-registered before it is run, like the two
before it.

## Known limitations, recorded rather than buried

- **The funding model is internally inconsistent, and says so in its own
  source.** Cash accounting debits the full notional on open, as a cash-funded
  equity account would, while financing is charged on that same notional, as a
  margin account would. A position paid for outright should not also pay
  financing. Resolving it needs a per-instrument margin requirement from the
  broker's symbol specification. Measured size on study 1: about 2.5 points of
  return over 12.5 years at 3%/yr — it moves no verdict, and it is written into
  `portfolio.ts` so the next person does not rediscover it.
- **No margin model.** Fine for cash instruments, wrong for leveraged CFDs.
- **No partial fills or liquidity model in the simulator.** Every order fills in
  full at one price.
- **Daily bars have no intrabar path**, so a bar containing both stop and target
  is resolved as the stop.
- **Effective breadth was 5.4**, not 12. Seven USD-driven FX pairs are not seven
  bets.
- **21% of gold and 28% of AUDCAD minute bars report no spread**, and the
  missing ones are the more volatile ones. Every measured cost in this repo is
  therefore taken over the calmer half of the data and is, if anything,
  understated.

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
