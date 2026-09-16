// The risk policy — the fixed limits the system operates inside.
//
// This type is deliberately plain data with no methods and no setters. There is
// no `updateLimits()` anywhere in this domain, and nothing in the signal path
// receives a mutable reference to a policy. A strategy, an LLM, or anything
// downstream of either can propose an order and can be told no; it has no
// vocabulary for changing what "no" means.
//
// Every value is a HARD limit. None of them is advisory, and none of them is
// relaxed by confidence, conviction, recent performance, or any other input.

export type RiskPolicy = {
  // ---- size and exposure ----
  /** Absolute ceiling on one position, in instrument units (lots/shares/contracts). */
  maxPositionUnits: number;
  /** One position's notional as a percent of equity. */
  maxPositionNotionalPct: number;
  /** All positions' combined notional as a percent of equity. */
  maxTotalNotionalPct: number;
  /** Total notional divided by equity. On a leveraged account this is the
   *  number that actually decides whether a gap liquidates you. */
  maxLeverage: number;
  maxOpenPositions: number;

  // ---- loss control ----
  /** Loss from the day's starting equity that stops new entries. */
  maxDailyLossPct: number;
  /** Loss from all-time peak equity that stops new entries. Survives restarts,
   *  unlike the daily limit, which resets. */
  maxDrawdownPct: number;

  // ---- market quality ----
  /** Reject entries when the bid/ask spread exceeds this percent of mid price.
   *  Wide spread is both a direct cost and a reliable signal that conditions
   *  are not normal. */
  maxSpreadPct: number;
  /** A quote older than this is not a price, it is a memory. */
  maxQuoteAgeSeconds: number;

  // ---- throttle ----
  /** Caps runaway behaviour from a strategy bug or a feedback loop. */
  maxOrdersPerHour: number;
  minSecondsBetweenOrders: number;
};

/**
 * Conservative starting values, chosen to be obviously survivable rather than
 * optimal. These are placeholders until real account and instrument data
 * replaces them — in particular `maxPositionUnits` is meaningless until the
 * instrument's unit (lot vs share vs contract) is known.
 */
export const CONSERVATIVE_POLICY: RiskPolicy = {
  maxPositionUnits: 1,
  maxPositionNotionalPct: 20,
  maxTotalNotionalPct: 40,
  maxLeverage: 2,
  maxOpenPositions: 2,
  maxDailyLossPct: 2,
  maxDrawdownPct: 10,
  maxSpreadPct: 0.05,
  maxQuoteAgeSeconds: 120,
  maxOrdersPerHour: 6,
  minSecondsBetweenOrders: 60,
};

/** Deep-freeze a policy so a stray reference cannot mutate limits at runtime.
 *  Belt and braces next to the type-level readonly-ness, because the thing this
 *  guards against is a bug, and bugs do not respect types at runtime. */
export function freezePolicy(policy: RiskPolicy): Readonly<RiskPolicy> {
  return Object.freeze({ ...policy });
}
