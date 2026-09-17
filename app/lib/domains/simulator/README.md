# Simulator — paper-trading harness

Phase 6's deterministic core (`ROADMAP.md`). A strategy proposes, a Risk Manager
decides, a paper broker fills against historical bars. Nothing here can reach a
real venue, and `runBacktest` throws if handed an adapter that could.

```
  Strategy ──┐
             ├─▶ Signal ──▶ Risk Manager ──▶ Order ──▶ Execution Adapter ──▶ Fill
  AI output ─┘   (intent)   (deterministic)            (paper only)           │
                                 │                                            ▼
                            kill switch                                   Portfolio
                            sizing, caps                                       │
                                                                           Metrics
```

Run it:

```bash
npm run backtest                        # seeded synthetic data
npm run backtest -- --csv data/spy.csv  # real OHLCV
npm run backtest -- --help
```

## The one rule this domain is built around

`AI_ARCHITECTURE.md`: *"AI layer can only ever produce a Signal; only the
deterministic Risk Manager + Execution Adapter can touch a broker."*

That is enforced by the types, not by discipline. A `Signal` has no `quantity`
field, so no strategy — LLM-driven or otherwise — can express *"buy 400 shares"*.
Size exists only in `risk.ts`. The most an AI can contribute is a direction, a
stop and a confidence; everything with a dollar attached to it is arithmetic in
a pure function with tests on it.

`parseSignal()` is the only door model output comes through. It pins the symbol
to the one requested (a model that starts talking about a different ticker after
reading news text is rejected, not followed), assigns `source` from the caller
so a model cannot label its own suggestion as rule-derived, drops invented
fields like `quantity` or `leverage`, and degrades to `hold` on anything
malformed. Model `rationale` text is data: it gets logged and shown to a human,
never fed back as instructions.

## No look-ahead

`PRODUCT_SPEC.md` names this as a Simulator requirement. Two structural rules in
`backtest.ts`:

1. A strategy deciding on bar `i` receives a **frozen copy** of bars `0..i`.
   There is no reference into the full series to walk past the end.
2. An order created on bar `i` executes at bar `i+1`'s **open** — never the
   close it was decided from.

Resting stops and targets are the only exception, and only in the direction that
makes results worse: they fill inside the bar they are touched, at the stop
price, or at the open when the bar gapped straight through it. When one bar
contains both the stop and the target, the run assumes the stop filled first.
Anything else systematically flatters the result.

`backtest.test.ts` includes a strategy that only buys when tomorrow closes
higher. Every bar in that fixture closes higher, so a leaking engine would trade
all of them; it takes zero trades.

## Risk Manager

`risk.ts` is where a signal becomes a position, or doesn't. Every rejection is
recorded with a reason — on a run that did nothing, `result.rejections` is
usually the most informative output.

Sizing takes the smallest of three ceilings: the risk budget
(`maxRiskPerTradePct` of equity, over the entry→stop distance), the notional cap
(`maxPositionPct` — this is what binds when a stop is tight, where risk-based
sizing alone would buy an enormous position), and available cash. Fractional
units are floored, never rounded up.

The daily-loss halt latches: once tripped it stays tripped for the day even if
equity recovers, and it is cleared only by a new trading day. It blocks new
entries and **never blocks an exit** — a halt that traps you in an open position
is worse than no halt. With `flattenOnKillSwitch` (default on) it also closes
what is already open, at the next bar's open.

## What the model does not include

Stated plainly, because a backtest that silently ignores these produces numbers
that cannot happen:

- **No margin, leverage, or borrow cost.** Shorts are credited proceeds and
  carry no financing charge. On leveraged instruments — CFDs, futures, FX — this
  is badly wrong, and this engine would need a margin model before it meant
  anything there.
- **No partial fills and no liquidity model.** Every order fills in full at one
  price. Slippage is a flat basis-point haircut, not a function of size.
- **No spread, swap, overnight financing, or dividend adjustment.**
- **One symbol per run.** `maxOpenPositions` exists for a portfolio runner that
  does not exist yet.
- **No intrabar path.** Stop and target resolution sees only OHLC, which is why
  the both-in-one-bar case has to assume the loss.
- **Bar data only.** No tick data, no order book, no queue position.
- **Float arithmetic** rounded at the boundaries. A live-money version would use
  integer minor units.

## Going live — what an adapter would have to do

`ExecutionAdapter` is the seam. A MetaTrader 5, Alpaca, or IBKR adapter
implements `submit()` and sets `isLive: true`; `runBacktest` refuses those by
design, so a live adapter needs a separate live runner that a backtest can never
reach by accident.

Before any such adapter exists, the following are prerequisites rather than
nice-to-haves, and none of them are in this codebase today:

- **Credentials never enter this repository or an agent session.** They belong
  in environment variables on the machine that runs the live loop, held by a
  person. Anything committed to git is permanent, and anything pasted into a
  chat session is stored.
- **Idempotent order submission.** A retried request must not double-fill.
  Client-assigned order ids exist for this; the paper broker already takes ids
  from the caller rather than generating them.
- **Reconciliation on startup.** The broker's positions are the truth, not the
  local `AccountState`. A process that restarts and trusts its own memory will
  eventually double a position.
- **A margin model**, if the instrument is leveraged. MT5 accounts usually are.
- **A halt that survives a restart.** The kill switch currently lives in memory
  and resets with the process.
- **An audit trail** through `app/lib/audit.ts`, per `ARCHITECTURE.md`'s rule
  that every domain writes through the one shared logger.

`PRODUCT_SPEC.md` lists *"no real trades, no broker fund movement, no live risk
of any kind"* as a permanent non-goal for the education platform. A live loop is
therefore a separate application that imports this domain — not a flag flipped
on inside Trading X.

## Files

| File | |
|---|---|
| `types.ts` | Bar, Signal, Order, Fill, Position, ClosedTrade |
| `signal.ts` | the AI boundary — parsing and validating untrusted signal output |
| `risk.ts` | position sizing, exposure caps, the latching daily-loss halt |
| `portfolio.ts` | cash and position accounting, realized/unrealized PnL |
| `broker.ts` | `ExecutionAdapter`, the paper broker, slippage and commission |
| `backtest.ts` | the runner and its no-look-ahead guarantees |
| `metrics.ts` | drawdown, profit factor, Sharpe; win rate via `journal/stats.ts` |
| `datasource.ts` | provider-agnostic market data, validation, CSV parsing |
| `indicators.ts` | SMA, ATR, true range, crossover tests |
| `strategies/` | worked examples of the `Strategy` interface |

Closed trades are shaped to match the journal domain's `StatTrade`, so win rate,
average R and setup ranking come from `computeJournalStats` — a student sees the
same numbers computed the same way whether a trade was manual or simulated.
