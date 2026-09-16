# INTRADAY FEASIBILITY SCREEN — 2026-09-16

Not a study and not a strategy. A screen, run before writing a third
hypothesis, to find out which intraday questions are worth asking at this
broker and which are arithmetically closed.

Reproduce:

```bash
npm run intraday -- --file <MT5 M1 export> --point 0.01 --server-offset 3
```

## 1. Why this came first

I had recorded "no intraday" as a binding constraint in `TRADING_SYSTEM.md`.
That was true of the **data plan** and false of **the data I actually hold**:
the operator's two MT5 exports are 99,879 minute bars each, with the broker's
own per-bar spread attached. I had been treating a limitation of one source as
a limitation of the whole problem. That is the kind of error that quietly
removes the most promising direction from consideration, so it is recorded
here rather than fixed in silence.

What the exports do not give is length. **Both cover roughly three months**
(gold 2026-06-02 → 09-16, AUDCAD 2026-06-11 → 09-16). That is one regime. It
is far too short to test whether a signal works and entirely sufficient to
measure what trading costs, because spread is a property of the venue rather
than of the market's direction.

## 2. The question, and why it is phrased this way

"Spread is 0.3 bps" is not actionable. The same 0.3 bps is negligible against a
25 bps move and fatal against a 0.3 bps one. Cost only means something relative
to the size of the move being chased.

So the screen converts cost into the only currency a signal trades in — a
directional hit rate:

> Win the full move when right, lose it when wrong, pay the round-trip spread
> either way. `E[pnl] = m(2p − 1) − s`, so break-even sits at
> **`p = 0.5 + s / 2m`**.

That puts the broker's cost on a scale with a hard ceiling at 100%, which is
what makes exclusions possible. For reference, the two hypotheses tested in
this repo achieved **48.3%** and roughly a coin flip.

**The screen is deliberately optimistic, and that is what makes it valid.** It
credits a winner with the entire move and charges a loser with exactly the
same, models spread but no slippage, and ignores commission and financing. A
real strategy with stops has a worse payoff than this. So every figure below is
a **lower bound** on what is really required. A cell the screen closes is
definitely closed; a cell it leaves open may still be closed in practice. Its
negative results are sound and its positive ones are permissions to ask, not
findings.

## 3. The broker's clock, measured

Every hour below is UTC, which required knowing the server offset rather than
assuming it. AUDCAD's last bar before each weekend gap is **Friday 23:59
server time**, and the FX week ends at 17:00 in New York — 20:59 UTC in
September. **The server runs GMT+3.** No daylight-saving transition falls inside
either export window, so the offset is constant throughout.

Gold's volatility profile then independently confirms it: the largest minute
moves land at 13:00 UTC, the New York open, and the smallest at 04:00 UTC, the
Asian lull. Had the offset been wrong, that shape would have been rotated.

## 4. Result: the two instruments are not in the same business

Required break-even hit rate, worst and best hours:

### XAUUSD (gold) — nothing is closed

| Horizon | Best hour | Worst hour |
|---|---|---|
| 1 min | **52.5%** (13:00, NY open) | 63.5% (22:00) |
| 5 min | 51.2% | 56.3% |
| 15 min | 50.6% | 53.6% |
| 60 min | 50.3% | 51.8% |

**43 of 87 cells affordable, 0 arithmetically impossible.**

### AUDCAD — most of it is closed

| Horizon | Best hour | Worst hour |
|---|---|---|
| 1 min | 55.6% (14:00) | **491.5%** (21:00) |
| 5 min | 52.6% | 239.1% |
| 15 min | 51.4% | 165.0% |
| 60 min | 50.7% | **121.7%** |

**9 of 96 cells affordable, 56 implausible, 4 arithmetically impossible.**

The difference is not the spread — the two are comparable, 0.22 and 0.20 bps at
their best hours. It is the move. Gold travels about **4.4 bps** in a typical
minute at 13:00 UTC against AUDCAD's **0.9 bps**. Five times the distance for
roughly the same toll.

## 5. The one hard exclusion

**AUDCAD cannot be traded at 21:00 UTC. At any horizon up to an hour. By
anything.**

| | |
|---|---|
| Median spread, 21:00 UTC | **75 points** |
| Median spread, every other hour | **2 points** |
| Ratio | **38×** |
| Required hit rate, 1 min | **491.5%** |
| Required hit rate, 60 min | **121.7%** |
| Bars measured | 4,120, **0% missing** |

21:00 UTC is 00:00 on a GMT+3 server: the daily rollover, when liquidity
providers step back and the book widens. And it is not a spike to be timed
around — the median holds between 69 and 86 points in **every ten-minute block
of the hour**:

| Minutes | :00–:09 | :10–:19 | :20–:29 | :30–:39 | :40–:49 | :50–:59 |
|---|---|---|---|---|---|---|
| Median points | 72 | 69 | 86 | 78 | 75 | 75 |

A probability cannot exceed 1, so this is arithmetic rather than an argument
about whether some signal might be good enough.

**It excludes trading in that hour, not holding through it.** A position opened
at 18:00 and closed at 23:00 never crosses the rollover book and pays none of
this. The exclusion binds on strategies that *transact* at 21:00 — which is
exactly what a naive "one decision per hour, every hour" design does.

## 6. What this does not establish

Each of these could overturn something above.

1. **Three months is one regime.** Spread regimes move with volatility and with
   the broker's own pricing. Nothing here says 21:00 UTC was this bad last year
   or will be next year. It says what it cost over this window.
2. **The missing-spread bias runs the flattering way.** 21% of gold bars and 28%
   of AUDCAD bars report a spread of exactly 0, which is missing data — see the
   note in `mt5-import.ts`. Those bars have a *wider* high-low range than the
   ones that report, so whatever suppresses the reading tracks volatility, and
   the medians here are taken over the calmer half. **Costs are understated,
   probably everywhere.** Five AUDCAD hours are missing over 40%, flagged with
   `*` in the output, and two of them are the two cheapest-looking hours — read
   those rows as barely evidence at all.
3. **Overlapping windows.** Forward moves are measured from every minute, so
   observations are not independent. Fine for estimating how far price
   typically travels, which is all that is asked. It would not be fine for a
   significance test, and none is claimed.
4. **Mean versus median.** Break-even uses the mean absolute move, because
   expected P&L is additive. On a fat-tailed series the mean is set by a small
   number of minutes a real strategy would not reliably catch, which is a
   further reason the true requirement is higher than shown. Both statistics are
   carried in `HorizonStat` so the gap stays visible.
5. **Windows straddling session gaps are discarded**, so the weekend jump is not
   being counted as a tradeable move.

## 7. The second screen: is there enough data to look?

Cost says where an edge could survive. It does not say whether this data could
*see* one. That question belongs before a hypothesis too, because a test
without enough observations does not return "no edge" — it returns a number
with no information in it, which then gets argued about. Worse, an
underpowered test that happens to land above its threshold is the single most
likely route by which a false positive gets promoted to live trading.

Observations here are **non-overlapping**: a 15-minute horizon yields four per
hour, not sixty. Counting every bar would claim fifteen times the information
actually present, which is exactly the arithmetic that makes an underpowered
study look adequate.

XAUUSD, one-sided, α = 0.05, power = 0.80:

| Window | Horizon | Independent n | Break-even | Smallest detectable edge | |
|---|---|---|---|---|---|
| Cheapest hours (12–14 UTC) | 15 min | 911 | 50.69% | **+4.11%** | underpowered 4.2× |
| Cheapest hours (12–14 UTC) | 60 min | 227 | 50.36% | +8.21% | underpowered 17× |
| **All hours pooled** | **15 min** | **6,658** | **51.65%** | **+1.52%** | **adequate** |
| All hours pooled | 60 min | 1,591 | 50.80% | +3.11% | underpowered 2.4× |

**The two screens disagree, and that is the result.** Cost points at 12:00–15:00
UTC, where gold is cheapest to trade. Restricting to those three hours leaves
911 observations, enough to detect only a +4.11 point edge — a 54.8% hit rate,
better than essentially any published intraday result net of costs. Looking
where it is cheapest destroys the ability to see anything.

Pooling every hour restores the sample to 6,658 and brings the detectable edge
down to +1.52 points, but raises break-even to 51.65% by mixing the expensive
hours back in.

**Exactly one adequately powered test exists in this data: gold, 15-minute
horizon, all hours, and a signal must reach about 53.2% to be distinguishable
from noise.** That is a demanding bar — neither hypothesis tested here came
close — but it is not an absurd one for an intraday signal, and it is a bar
fixed by arithmetic rather than chosen after the fact.

Everything else on the table is a study that cannot succeed and should not be
run.

## 8. What it licenses

Only this, and it is narrow:

- **One hypothesis is worth pre-registering: gold, 15-minute horizon, all
  hours.** It is the only window where cost permits an edge to survive *and*
  the data can detect one. The bar it must clear is **~53.2%**, which is
  break-even plus the smallest detectable edge, and both halves of that number
  were fixed before any return was measured.
- **Do not narrow to the cheap hours.** It is the obvious move on the cost
  table and it takes the sample below what can resolve any plausible edge.
- **AUDCAD intraday is not worth a hypothesis** at this broker. Nine affordable
  cells out of ninety-six, every one of them needing a hit rate above anything
  either tested hypothesis reached, with the cheapest-looking hours resting on
  half-missing data.
- **Any design that trades on a fixed schedule must exclude 21:00 UTC** for
  AUDCAD and treat 22:00–23:00 UTC as expensive for gold.

None of this is evidence that an edge exists. It narrows where one could
survive if it did, and then narrows again to where its absence would mean
something. The next step is a pre-registered hypothesis with a stated
mechanism, criteria fixed before the run, and the out-of-sample window — still
untouched after two studies — left alone until something earns it.

**A note on what this screen cost.** Two of the three things it established are
negative: a whole hour of AUDCAD that nothing can trade, and three windows out
of four that cannot be tested. Those were cheaper to find here than in a study,
and much cheaper than in a live account.
