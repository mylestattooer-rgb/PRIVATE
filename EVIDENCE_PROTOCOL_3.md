# EVIDENCE PROTOCOL 3 — pre-registered 2026-09-16

**Committed before the hypothesis was run.** The commit history is the evidence
for that claim, and it is the only thing that makes the result below worth
anything. Nothing in this document may be edited after the run except by adding
a dated note that says what changed and why.

The two protocols before this one each produced a falsification, and both held
because the criteria were fixed while it was still possible to be wrong about
them.

## 1. Hypothesis

> After an unusually large five-minute move in XAUUSD, the **next** five-minute
> return reverses more often than it continues.

## 2. Mechanism, stated so it can fail

Not "prices mean-revert", which is a description rather than a cause. The
claimed mechanism is **dealer inventory**:

A large directional order has to be absorbed by whoever is quoting. They take
the other side not because they want the position but because that is the
business, and they are then holding inventory they did not choose. Unwinding it
means pushing price back the way it came. The effect should therefore be a
property of *absorption*, not of price movement as such.

That distinction is what makes it falsifiable. A move driven by **information**
should show the opposite: the quote steps to a new level and stays there. So
the same instrument should show reversion after absorption and continuation
after news, and a hypothesis that predicts reversion after every large move is
already the wrong shape.

## 3. Honest prior

**Low.** Short-horizon reversion is the most heavily mined effect in all of
market microstructure, and it is the core inventory of firms with far better
data, far lower costs and latency measured in microseconds.

The one reason it is worth testing at all at this horizon: those firms compete
at milliseconds. Five minutes is four orders of magnitude slower, which is both
why a retail account could act on it and why it is unlikely to still be there.
If an edge survives at five minutes, the interesting question is immediately
why no one has taken it — and the most probable answer is that it has not.

I expect this to fail. It is worth running because it is the first hypothesis
in this repo with a mechanism that the available data can actually test, and
because a null result at adequate power is a real result.

## 4. Everything fixed in advance

Every number here is chosen now and may not be changed after seeing a result.
Where a choice is arbitrary it is marked, so that a later reader can see what
was a judgement and what was forced.

| | | |
|---|---|---|
| Instrument | **XAUUSD**, the operator's own MT5 export | forced — the only instrument the cost screen leaves open |
| Bars | 99,879 M1, 2026-06-02 → 2026-09-16 | forced |
| Server offset | **GMT+3** | measured, see `INTRADAY_FEASIBILITY.md` §3 |
| Horizon | **5 minutes** | forced by power, see §6 |
| Hours | **all** | forced by power — narrowing to the cheap hours destroys the sample |
| Trigger | `abs(5-minute return)` above its **trailing median** | rate forced by power; median over trailing window is a judgement |
| Trailing window | **1,000 minutes**, causal | judgement |
| Direction | short after an up-move, long after a down-move | forced by the hypothesis |
| Exit | **exactly 5 minutes later**, no stop, no target | judgement — a stop would confound the test with an exit rule |
| Observations | **non-overlapping** | forced — see §6 |
| Split | first **70%** in-sample, last **30%** untouched | judgement |
| Spread | **13 points median**, excluding the 21% of bars that report zero | measured |
| Point size | 0.01 | from the instrument |

**No parameter will be swept.** If the result fails, the hypothesis is
falsified and the next one is different — not this one retuned. Study 1 already
demonstrated what a 36-configuration sweep does to a headline number.

## 5. Predictions

Each is stated with the number it must clear, before the run.

| | Prediction | Threshold | Why it is here |
|---|---|---|---|
| **P1** | Raw reversion hit rate beats break-even by more than noise | **≥ 54.34%** | The primary. Decisive on its own |
| **P2** | The effect strengthens with the size of the triggering move | top quintile hit rate > the 50–80th percentile band | The mechanism test — inventory scales with the order absorbed |
| **P3** | It is not a bid-ask artefact | effect at 5m must not be dwarfed by the effect at 1m | Negative autocorrelation from quote bounce decays in seconds, not minutes |
| **P4** | It is not concentrated in one hour or one fortnight | no single hour contributes >25% of the total edge; both halves of the window positive | Guards against one event driving everything |
| **P5** | It survives the measured spread | net return > 0 after 0.305 bps round trip | Break-even already encodes this; P5 checks it end to end |

**P1 is the falsification test. P2 is the mechanism test.** If P1 passes and P2
fails, the hypothesis is *not* confirmed: an effect that does not scale with the
size of the absorbed order is not the inventory effect being claimed, whatever
else it might be, and it would be reported as an unexplained anomaly rather than
a validated mechanism.

### Where 54.34% comes from

It is not a round number and it was not chosen to be reachable. It is:

> **break-even (52.86%) + smallest detectable edge at this sample (1.48 points)**

Break-even is what the measured spread costs, in hit-rate terms, pooled across
hours and weighted by bar count. The detectable edge is what 6,991 independent
observations can distinguish from noise, one-sided at α = 0.05 with 80% power.
Both halves were computed before any return was measured, and neither can be
adjusted by anything the run produces.

A result of, say, 53.5% would be **above break-even and still a failure** — it
would mean the effect, if real, is smaller than this data can resolve. That is
a null result, not a small win, and it will be reported as one.

## 6. Power: what the design cost

The design was chosen by power analysis rather than by preference, and the
choice cost something real.

| Horizon | Break-even | Total n | In-sample (70%) | Adequate at trigger rate 100% / 50% / 20%? |
|---|---|---|---|---|
| 1 min | 56.39% | 99,879 | 69,915 | yes / yes / yes |
| **5 min** | **52.86%** | **19,975** | **13,982** | **yes / yes / no** |
| 15 min | 51.65% | 6,658 | 4,660 | yes / no / no |
| 60 min | 50.80% | 1,591 | 1,113 | no / no / no |

Reading down: shorter horizons buy sample and raise the bar, because the spread
is a larger share of a smaller move. One minute has seventy thousand
observations and a break-even of 56.39%, above anything credible. One hour has a
comfortable 50.80% break-even and cannot be tested at all.

Conditioning costs sample in direct proportion to how often the trigger fires,
which is why the trigger rate is a column here rather than a free choice.

**What this forced.** The sharp version of the hypothesis — reversion after
*tail* moves, the top quintile, where an inventory effect should be strongest —
needs 3,844 observations and has 2,796. **It cannot be adequately tested on this
data.** So the primary test uses an above-median trigger, which fires on half
the bars and dilutes the effect with ordinary ones.

That is a weaker test than the mechanism deserves, and it is recorded here
rather than discovered later:

- **P1 is adequately powered** — 6,991 observations against 3,844 needed, a
  margin of 1.8×.
- **P2 is not.** The top-quintile comparison is underpowered by 1.4×, so a P2
  failure is weak evidence and will be reported as weak. P2 can support the
  mechanism; it cannot refute it on this sample.

Stating which of your own tests are too weak to conclude from, before running
them, is the only way that distinction survives contact with the result.

## 7. Data handling

- **The last 30% of the series is not to be touched** until P1 has been
  evaluated in-sample. It is one-shot. If the in-sample result fails, the
  holdout is not spent — the same rule that has kept the daily out-of-sample
  window intact through two studies.
- **Bars with no spread reading are excluded from cost**, not treated as free.
  21% of this export reports zero, and those bars are more volatile than the
  ones that report, so measured cost here is if anything understated.
- **Windows straddling a session gap are discarded.** The weekend jump is not
  something a five-minute strategy trades.
- **No look-ahead.** The trailing median is causal — computed from bars strictly
  before the decision bar. The existing engine invariant applies: appending a
  future bar must not change any earlier result.

## 8. What will not be done

- **No parameter search.** One configuration, fixed above, run once.
- **No threshold adjustment after the fact.** 54.34% is fixed. If the result
  lands at 54.0% it is a failure, and an argument that 54.0% is "basically
  there" is exactly the argument this document exists to prevent.
- **No dropping of a prediction that fails.** All five get reported.
- **No re-run with a different cost assumption** to rescue a negative result.
- **No live trading.** Nothing here approaches that question, and a single
  passing in-sample study would not either.

## 9. If it passes

It almost certainly will not. If P1 and P2 both pass in-sample, the order is:

1. Report the in-sample result in full, including the predictions that failed.
2. **Then** run the held-out 30%, once.
3. If that holds, forward paper trading against the live feed — which tests the
   things a backtest structurally cannot: real fills, real latency, real
   rejections.
4. Live remains off regardless. It is enabled by a person, deliberately, once.

Three months is one regime. Even a clean pass through all of the above would
establish that the effect existed in June–September 2026, and nothing more.
