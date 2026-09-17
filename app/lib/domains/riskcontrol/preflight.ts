// The preflight gate. Every order that would OPEN or INCREASE exposure passes
// through here first, and it is a pure function: same inputs, same verdict, no
// clock, no I/O, no hidden state.
//
// Three properties are deliberate and worth not "simplifying" later:
//
// 1. **Closes are never blocked.** Every limit here gates new risk. A gate that
//    can trap you in a losing position is worse than no gate.
//
// 2. **Every check runs.** The gate does not stop at the first violation, so a
//    rejection reports everything that was wrong rather than the first thing.
//    That is what makes the decision log in step 5 worth reading.
//
// 3. **It fails closed.** Missing equity, a missing quote, a NaN — anything the
//    gate cannot evaluate is a denial, never a pass. An unevaluated check is not
//    a passed check.

import type { RiskPolicy } from "./policy";

export type ProposedOrder = {
  symbol: string;
  side: "buy" | "sell";
  /** Instrument units. Must mean the same thing as `RiskPolicy.maxPositionUnits`. */
  quantity: number;
  intent: "open" | "close";
  /** Reference price used for notional. */
  price: number;
};

export type OpenPosition = {
  symbol: string;
  /** Signed: positive long, negative short. */
  quantity: number;
  /** Absolute notional value of the position. */
  notional: number;
};

export type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  /** ISO timestamp of the quote. */
  at: string;
};

/** Anything already forcing the system to stand down — reconciliation failure,
 *  connectivity loss, an unresolved order, the manual kill switch. */
export type ActiveHalt = { reason: string; detail: string };

export type RiskSnapshot = {
  /** ISO timestamp treated as "now". Passed in, never read from a clock, so a
   *  decision can be replayed exactly. */
  at: string;
  equity: number;
  dayStartEquity: number;
  /** All-time high equity, persisted across restarts. */
  peakEquity: number;
  positions: OpenPosition[];
  quote: Quote | null;
  /** ISO timestamps of recent order submissions, any order. */
  recentOrderTimes: string[];
  halts: ActiveHalt[];
};

export type ViolationCode =
  | "invalid_input"
  | "halt_active"
  | "missing_quote"
  | "stale_quote"
  | "spread_too_wide"
  | "position_units_exceeded"
  | "position_notional_exceeded"
  | "total_exposure_exceeded"
  | "leverage_exceeded"
  | "max_open_positions"
  | "daily_loss_limit"
  | "drawdown_limit"
  | "order_rate_limit"
  | "order_cooldown";

export type CheckResult = {
  code: ViolationCode;
  passed: boolean;
  /** Human-readable, and the exact text the decision log records. */
  detail: string;
  /** The measured value and the limit it was compared against, for the
   *  dashboard and for replay. */
  observed: number | null;
  limit: number | null;
};

export type RiskVerdict = {
  allowed: boolean;
  /** Every check that ran, passed or failed, in a stable order. */
  checks: CheckResult[];
  violations: CheckResult[];
};

const pass = (code: ViolationCode, detail: string, observed: number | null = null, limit: number | null = null): CheckResult =>
  ({ code, passed: true, detail, observed, limit });

const fail = (code: ViolationCode, detail: string, observed: number | null = null, limit: number | null = null): CheckResult =>
  ({ code, passed: false, detail, observed, limit });

function secondsBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 1000;
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/**
 * Evaluate a proposed order against the policy.
 *
 * Closing orders short-circuit to allowed with a single recorded check — not
 * because closes are risk-free, but because refusing one is strictly worse than
 * allowing it.
 */
export function preflight(
  order: ProposedOrder,
  snapshot: RiskSnapshot,
  policy: RiskPolicy,
): RiskVerdict {
  if (order.intent === "close") {
    const checks = [pass("halt_active", "closing orders are never gated")];
    return { allowed: true, checks, violations: [] };
  }

  const checks: CheckResult[] = [];

  // ---- input sanity. Fail closed on anything unevaluable. ----
  if (!finite(order.quantity, order.price, snapshot.equity, snapshot.dayStartEquity, snapshot.peakEquity)) {
    checks.push(fail("invalid_input", "order or account figures are not finite numbers"));
    return { allowed: false, checks, violations: checks };
  }
  if (order.quantity <= 0 || order.price <= 0) {
    checks.push(fail("invalid_input", `quantity ${order.quantity} and price ${order.price} must both be positive`));
    return { allowed: false, checks, violations: checks };
  }
  if (snapshot.equity <= 0) {
    checks.push(fail("invalid_input", `equity ${snapshot.equity} is not positive; no percentage limit is meaningful`));
    return { allowed: false, checks, violations: checks };
  }
  checks.push(pass("invalid_input", "inputs are well-formed"));

  // ---- standing halts ----
  checks.push(
    snapshot.halts.length === 0
      ? pass("halt_active", "no active halts")
      : fail(
          "halt_active",
          `halted: ${snapshot.halts.map((h) => `${h.reason} (${h.detail})`).join("; ")}`,
          snapshot.halts.length,
          0,
        ),
  );

  // ---- market quality ----
  if (!snapshot.quote) {
    checks.push(fail("missing_quote", `no quote available for ${order.symbol}`));
    checks.push(fail("stale_quote", "cannot assess quote age without a quote"));
    checks.push(fail("spread_too_wide", "cannot assess spread without a quote"));
  } else {
    const { bid, ask, at } = snapshot.quote;
    checks.push(pass("missing_quote", `quote present for ${snapshot.quote.symbol}`));

    const age = secondsBetween(at, snapshot.at);
    if (age === null) {
      checks.push(fail("stale_quote", `quote timestamp "${at}" is unparseable`));
    } else {
      checks.push(
        age <= policy.maxQuoteAgeSeconds
          ? pass("stale_quote", `quote is ${age.toFixed(1)}s old`, age, policy.maxQuoteAgeSeconds)
          : fail(
              "stale_quote",
              `quote is ${age.toFixed(1)}s old, limit is ${policy.maxQuoteAgeSeconds}s`,
              age,
              policy.maxQuoteAgeSeconds,
            ),
      );
    }

    const mid = (bid + ask) / 2;
    if (!finite(bid, ask) || mid <= 0 || ask < bid) {
      checks.push(fail("spread_too_wide", `quote is malformed: bid ${bid}, ask ${ask}`));
    } else {
      const spreadPct = ((ask - bid) / mid) * 100;
      checks.push(
        spreadPct <= policy.maxSpreadPct
          ? pass("spread_too_wide", `spread is ${spreadPct.toFixed(4)}%`, spreadPct, policy.maxSpreadPct)
          : fail(
              "spread_too_wide",
              `spread is ${spreadPct.toFixed(4)}%, limit is ${policy.maxSpreadPct}%`,
              spreadPct,
              policy.maxSpreadPct,
            ),
      );
    }
  }

  // ---- size and exposure ----
  checks.push(
    order.quantity <= policy.maxPositionUnits
      ? pass("position_units_exceeded", `${order.quantity} units`, order.quantity, policy.maxPositionUnits)
      : fail(
          "position_units_exceeded",
          `${order.quantity} units exceeds the ${policy.maxPositionUnits} unit cap`,
          order.quantity,
          policy.maxPositionUnits,
        ),
  );

  const orderNotional = order.quantity * order.price;
  const positionNotionalPct = (orderNotional / snapshot.equity) * 100;
  checks.push(
    positionNotionalPct <= policy.maxPositionNotionalPct
      ? pass("position_notional_exceeded", `position is ${positionNotionalPct.toFixed(2)}% of equity`, positionNotionalPct, policy.maxPositionNotionalPct)
      : fail(
          "position_notional_exceeded",
          `position is ${positionNotionalPct.toFixed(2)}% of equity, limit is ${policy.maxPositionNotionalPct}%`,
          positionNotionalPct,
          policy.maxPositionNotionalPct,
        ),
  );

  const existingNotional = snapshot.positions.reduce((sum, p) => sum + Math.abs(p.notional), 0);
  const totalNotional = existingNotional + orderNotional;
  const totalPct = (totalNotional / snapshot.equity) * 100;
  checks.push(
    totalPct <= policy.maxTotalNotionalPct
      ? pass("total_exposure_exceeded", `total exposure would be ${totalPct.toFixed(2)}% of equity`, totalPct, policy.maxTotalNotionalPct)
      : fail(
          "total_exposure_exceeded",
          `total exposure would be ${totalPct.toFixed(2)}% of equity, limit is ${policy.maxTotalNotionalPct}%`,
          totalPct,
          policy.maxTotalNotionalPct,
        ),
  );

  const leverage = totalNotional / snapshot.equity;
  checks.push(
    leverage <= policy.maxLeverage
      ? pass("leverage_exceeded", `leverage would be ${leverage.toFixed(2)}x`, leverage, policy.maxLeverage)
      : fail(
          "leverage_exceeded",
          `leverage would be ${leverage.toFixed(2)}x, limit is ${policy.maxLeverage}x`,
          leverage,
          policy.maxLeverage,
        ),
  );

  // A proposal in a symbol already held is an increase, not a new position.
  const alreadyHeld = snapshot.positions.some((p) => p.symbol === order.symbol);
  const resultingCount = alreadyHeld ? snapshot.positions.length : snapshot.positions.length + 1;
  checks.push(
    resultingCount <= policy.maxOpenPositions
      ? pass("max_open_positions", `${resultingCount} open positions`, resultingCount, policy.maxOpenPositions)
      : fail(
          "max_open_positions",
          `${resultingCount} open positions exceeds the limit of ${policy.maxOpenPositions}`,
          resultingCount,
          policy.maxOpenPositions,
        ),
  );

  // ---- loss control ----
  const dailyLossPct =
    snapshot.dayStartEquity > 0
      ? ((snapshot.dayStartEquity - snapshot.equity) / snapshot.dayStartEquity) * 100
      : 0;
  checks.push(
    dailyLossPct < policy.maxDailyLossPct
      ? pass("daily_loss_limit", `down ${dailyLossPct.toFixed(2)}% on the day`, dailyLossPct, policy.maxDailyLossPct)
      : fail(
          "daily_loss_limit",
          `down ${dailyLossPct.toFixed(2)}% on the day, limit is ${policy.maxDailyLossPct}%`,
          dailyLossPct,
          policy.maxDailyLossPct,
        ),
  );

  const drawdownPct =
    snapshot.peakEquity > 0 ? ((snapshot.peakEquity - snapshot.equity) / snapshot.peakEquity) * 100 : 0;
  checks.push(
    drawdownPct < policy.maxDrawdownPct
      ? pass("drawdown_limit", `${drawdownPct.toFixed(2)}% below peak equity`, drawdownPct, policy.maxDrawdownPct)
      : fail(
          "drawdown_limit",
          `${drawdownPct.toFixed(2)}% below peak equity, limit is ${policy.maxDrawdownPct}%`,
          drawdownPct,
          policy.maxDrawdownPct,
        ),
  );

  // ---- throttle ----
  const ages = snapshot.recentOrderTimes
    .map((t) => secondsBetween(t, snapshot.at))
    .filter((s): s is number => s !== null && s >= 0);

  const inLastHour = ages.filter((s) => s <= 3600).length;
  checks.push(
    inLastHour < policy.maxOrdersPerHour
      ? pass("order_rate_limit", `${inLastHour} orders in the last hour`, inLastHour, policy.maxOrdersPerHour)
      : fail(
          "order_rate_limit",
          `${inLastHour} orders in the last hour reaches the limit of ${policy.maxOrdersPerHour}`,
          inLastHour,
          policy.maxOrdersPerHour,
        ),
  );

  const sinceLast = ages.length > 0 ? Math.min(...ages) : Infinity;
  checks.push(
    sinceLast >= policy.minSecondsBetweenOrders
      ? pass(
          "order_cooldown",
          ages.length === 0 ? "no prior orders" : `${sinceLast.toFixed(1)}s since the last order`,
          ages.length === 0 ? null : sinceLast,
          policy.minSecondsBetweenOrders,
        )
      : fail(
          "order_cooldown",
          `${sinceLast.toFixed(1)}s since the last order, minimum is ${policy.minSecondsBetweenOrders}s`,
          sinceLast,
          policy.minSecondsBetweenOrders,
        ),
  );

  const violations = checks.filter((c) => !c.passed);
  return { allowed: violations.length === 0, checks, violations };
}
