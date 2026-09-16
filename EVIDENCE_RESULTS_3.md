# EVIDENCE RESULTS 3 — in-sample, 2026-09-16

Run under `EVIDENCE_PROTOCOL_3.md`, committed before `scripts/study3.ts`
existed. Reproduce with `npx tsx scripts/study3.ts`.

## 1. Verdict

**Hypothesis 3 is falsified. P1 and P5 fail. The holdout was not touched.**

But it fails for a reason neither previous study did, and the reason is the
whole value of the run:

> **The effect is real. It is 4.3 standard errors above a coin flip. It is also
> 11% too small to pay the spread.**

| | |
|---|---|
| Reversion hit rate | **52.62%** over 6,724 observations |
| Distance from a coin flip | **+4.30 SE** (p ≈ 0.00001) |
| Break-even required by the spread | **52.86%** |
| Threshold set in advance | **54.34%** |
| Net after cost | **−0.0352 bps/trade** |

Hypotheses 1 and 2 found nothing: 48.3% and roughly a coin flip. This one found
something that is not in any doubt statistically, and then found that the
market has priced it to sit just underneath what a retail account pays to take
it.

## 2. The numbers that matter

| | Gross | Cost | Net |
|---|---|---|---|
| Per trade | **0.2852 bps** | 0.3200 bps | **−0.0352 bps** |
| 6,724 trades | +1,918 bps | −2,155 bps | **−237 bps** |

Put in the units the broker uses:

> The effect is worth **11.6 points** per round trip. The broker charges **13**.
> It pays for **89% of the toll.**

## 3. Predictions

| | Prediction | Result | |
|---|---|---|---|
| P1 | Hit rate ≥ 54.34% | **FAILS** | 52.62% |
| P2 | Effect scales with the size of the absorbed move | holds | 52.77% top quintile vs 52.61% band |
| P3 | Not a bid-ask artefact | holds | 1m reversion 51.53% < 5m 52.62% |
| P4 | Not concentrated in one hour or fortnight | holds | max hour 14.8% of edge; halves 52.91% / 52.34% |
| P5 | Survives the measured spread | **FAILS** | −237 bps |

**P3 is the most informative pass.** Quote bounce — the artefact that makes
naive reversion studies look profitable — decays in seconds. If this were
bounce, the one-minute effect would dwarf the five-minute one. It is *smaller*:
51.53% against 52.62%. The effect **builds** over minutes, which is what
inventory being worked off looks like and what an artefact of the quote does
not.

**P2 holds and proves little**, exactly as pre-registered. 52.77% against
52.61% is the right direction for the inventory mechanism, on a comparison
declared underpowered by 1.4× *before* it was run. It is consistent with the
mechanism and cannot establish it.

**P1 and P5 are the same failure counted twice**, which is by design: one in
hit-rate terms and one in currency.

## 4. The shortfall is smaller than the error on the thing it falls short of

This is where the result has to be handled carefully, because it is exactly the
shape of finding that gets talked into a strategy.

The hit rate is **0.39 standard errors below break-even**. That is nothing — it
is a coin's edge. So the honest statement is *not* "the effect loses", it is:

> **The effect sits on the cost line, and this data cannot tell which side.**

Three things stop that from being an argument to trade it:

1. **The measured cost is biased optimistic.** 21% of this export reports no
   spread, and those bars have a *wider* range than the ones that do. The 13
   points is a median over the calmer half of the data. The real toll is higher,
   and the gap is therefore wider than −0.39 SE.
2. **The screen was already generous.** Break-even assumes the full move is
   captured on a win and the full move lost on a miss, with no slippage, no
   commission and no financing. Every one of those omissions runs against the
   strategy.
3. **A pre-registered threshold does not get renegotiated after the run.** 54.34%
   was fixed while it was still possible to be wrong about it. 52.62% is not it.

## 5. What this says that the previous two studies could not

Both earlier hypotheses failed by finding nothing, which is compatible with
either "no effect exists" or "this test was too weak". This one distinguishes
the cases, and lands on a third:

**The effect exists, is highly significant, and has been competed down to just
below the level at which a retail account can take it.** That is not a
disappointing result — it is the efficient-markets prediction, observed
directly, with the boundary measured rather than assumed. The market does not
remove an inventory effect; it removes the *takeable* part of one, and what
remains is the part that pays the people whose costs are lower than yours.

That reframes what a small operator should look for. Not "find an effect" —
this repo now has one, in 6,724 observations, at p ≈ 0.00001. **Find an effect
whose size exceeds your own cost of taking it.** Those are different searches,
and the second is much harder, because everyone's costs differ and the market
clears at the lowest.

## 6. The one thing that would change the answer

The effect pays for 11.6 points and is charged 13. **An 11% tighter spread flips
it to break-even.**

That is recorded because it is true, and immediately qualified because it is
the most dangerous sentence in this document:

- 11% is **well inside the error of my own spread estimate**, and that error
  runs the wrong way (§4.1).
- Break-even is not profit. A strategy at exactly zero expectancy, trading 6,724
  times, carries drawdown, execution risk and operational risk in exchange for
  nothing.
- Better execution is not free. A raw-spread account charges commission, which
  this model does not include and which would have to come out of the same 11%.

**It is not a reason to trade this, and it will not be used as one.** It is the
reason the broker's actual commission schedule — the one number still missing
from the symbol specification — is worth more than another hypothesis.

## 7. What was not done

- **The holdout was not touched.** 5,846 observations remain unspent. Protocol
  §7: a failed in-sample result does not spend it. Three hypotheses in, both
  out-of-sample windows in this repo are intact.
- **No parameter was swept.** One configuration, fixed in §4 of the protocol,
  run once. There is no 36-configuration table in this document because there
  was no search.
- **The threshold was not moved.** 54.34%, fixed in advance and computed from
  break-even plus minimum detectable effect, neither of which the run can touch.
- **No cost assumption was relaxed** to rescue the result, though §6 shows
  exactly which one would have done it. That is precisely why it is stated with
  its refutation attached.

## 8. Adversarial review of this result

Run immediately after publication, on the principle that a 4.3-sigma finding
out of a brand-new script is exactly where to look for one's own bug. The same
exercise found nine real bugs earlier in this project, one of which invalidated
a published number.

**Three things were checked. The result survived all three, and one of them
strengthens it.**

**1. Does the trigger do anything, or is this just generic reversion?** The
worry came from this document's own P2, which was nearly flat. If conditioning
on move size changes nothing, "absorption" is the wrong story and the effect is
unconditional negative autocorrelation.

| | n | Hit rate |
|---|---|---|
| All observations | 13,849 | 52.02% |
| Above-median move | 6,924 | **52.77%** |
| Below-median move | 6,925 | **51.26%** |

**The trigger does real work — a 1.51 point gap.** The effect scales with the
size of the move, which is what the inventory mechanism predicts and what P2's
narrow comparison was too weak to show.

> **This is post-hoc and does not replace P2.** P2 was pre-registered as top
> quintile versus the 50–80th band, and that is what it stays. The comparison
> above was constructed after seeing the result, which is exactly the kind of
> test that can be built until it says what one wants. It is reported as a
> diagnostic, it is *not* counted toward the hypothesis, and it changes no
> verdict. The pre-registered P2 result stands as reported: passes, weakly,
> underpowered.

**2. Are consecutive observations independent?** They share a bar — observation
`i+h`'s trigger return *is* observation `i`'s forward return — so the hit
indicators could be correlated and the standard error understated, which would
undermine the "4.3 SE" claim directly.

Measured lag-1 autocorrelation of the hit indicator: **−0.016**. Effectively
zero, and the sign means the naive standard error is marginally *conservative*
rather than optimistic. The independence assumption holds.

**3. Is the trailing median causal?** Substituting a whole-sample median for
the causal trailing one scores **0.15 points higher** — look-ahead flattering
the result by precisely the amount one would expect. The study used the causal
version, confirmed by test.

**What the review did find: the analysis had no tests.** Every other
calculation in this repository is pinned; the one that produced a publishable
number was written inline in a script and verified by nothing. That is now
fixed — the logic is in `app/lib/domains/research/reversion.ts` behind 14
tests, including recovery of a known reversion rate from a hand-built series,
rejection of windows straddling a session gap, and a case where a 67% hit rate
still loses money. Re-running through the tested module reproduces every figure
in this document exactly.

Writing those tests while the answer was not in doubt is the point. They would
have been written anyway if something had gone wrong later, and by then they
would have been written to match whatever the code already did.

## 9. Honest assessment

Three hypotheses, three falsifications, and the quality of the failures has
improved each time: from "the strategy is indistinguishable from doing nothing",
to "the signal is a coin flip and there was no edge to lose", to **"the edge is
real, significant, and 11% too small."**

The infrastructure did what it was built for. The power analysis chose the
design and then correctly predicted which of its own tests would be too weak to
conclude from. The cost model, corrected twice, produced the number the verdict
turned on. The protocol held a threshold that the result came close enough to
make renegotiating tempting.

No strategy has earned the right to trade. Live mode is off.
