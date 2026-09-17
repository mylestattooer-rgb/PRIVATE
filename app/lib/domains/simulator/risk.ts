// The Risk Manager — the only module that can turn a Signal into an Order.
//
// Every rule here is deterministic and pure: same inputs, same decision, no
// clock, no randomness, no I/O. That is what makes the boundary in
// AI_ARCHITECTURE.md ("AI layer can only ever produce a Signal") worth
// anything — a model can propose a direction and a stop, but position size,
// cash checks and the daily-loss halt are arithmetic the model never touches.

import { roundCash, roundPrice } from "./money";
import type { Order, Position, Signal } from "./types";

export type RiskLimits = {
  /** Percent of equity to risk on one trade, measured entry→stop. */
  maxRiskPerTradePct: number;
  /** Ceiling on a single position's notional, as a percent of equity. Binds on
   *  tight stops, where risk-based sizing alone would buy an enormous position. */
  maxPositionPct: number;
  maxOpenPositions: number;
  /** Drawdown from the day's starting equity that halts new entries. */
  maxDailyLossPct: number;
  /** Signals below this confidence are ignored. */
  minConfidence: number;
};

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTradePct: 1,
  maxPositionPct: 20,
  maxOpenPositions: 3,
  maxDailyLossPct: 3,
  minConfidence: 0.55,
};

/**
 * Daily-loss halt. Latching by design: once tripped it stays tripped for the
 * rest of the session even if equity recovers, because the point is to stop a
 * bad day compounding, not to track a live threshold. Cleared only by
 * `openTradingDay()`.
 */
export type KillSwitchState = {
  day: string;
  dayStartEquity: number;
  tripped: boolean;
  reason: string | null;
};

export type RiskRejectionReason =
  | "hold"
  | "kill_switch_tripped"
  | "confidence_below_floor"
  | "missing_stop"
  | "stop_on_wrong_side"
  | "position_limit_reached"
  | "already_in_position"
  | "no_position_to_close"
  | "size_rounds_to_zero"
  | "insufficient_cash";

export type RiskDecision =
  | { approved: true; order: Order }
  | { approved: false; reason: RiskRejectionReason; detail: string };

export type RiskContext = {
  /** Mark-to-market account value the sizing percentages apply to. */
  equity: number;
  cash: number;
  /** Price the order is expected to transact near — the runner passes the
   *  current bar's close, which is the last price a decision could legally
   *  have seen. Fills happen later, at a price this module never assumes. */
  referencePrice: number;
  /**
   * Positions the broker has actually given us. Filled only.
   *
   * This is what an exit consults, and it must never include an order that is
   * merely working: a sell against an unfilled buy does not close anything, it
   * opens a short.
   */
  positions: Position[];
  /**
   * Exposure ordered but not yet filled, consulted only by the checks that
   * decide whether to open MORE.
   *
   * Kept apart from `positions` rather than merged into it because the two
   * answer different questions. An unfilled order is about to be a position, so
   * a limit that ignores it can be breached by a broker simply being slow; but
   * it is not a position, so it cannot be closed. Merging them got both halves
   * of that wrong in turn.
   *
   * Optional, and absent in backtests: the simulator fills every order in full
   * at one price, so nothing is ever working there.
   */
  working?: Position[];
  killSwitch: KillSwitchState;
  limits: RiskLimits;
  /** Caller-supplied so a backtest is reproducible; this module never
   *  generates ids or reads a clock. */
  orderId: string;
};

export function openTradingDay(day: string, equity: number): KillSwitchState {
  return { day, dayStartEquity: equity, tripped: false, reason: null };
}

/** Recompute the halt against current equity. Call once per bar, before sizing. */
export function evaluateKillSwitch(
  state: KillSwitchState,
  equity: number,
  limits: RiskLimits,
): KillSwitchState {
  if (state.tripped) return state;
  if (state.dayStartEquity <= 0) return state;

  const drawdownPct = ((state.dayStartEquity - equity) / state.dayStartEquity) * 100;
  if (drawdownPct < limits.maxDailyLossPct) return state;

  return {
    ...state,
    tripped: true,
    reason: `daily loss ${drawdownPct.toFixed(2)}% reached the ${limits.maxDailyLossPct}% limit`,
  };
}

function findPosition(positions: Position[], symbol: string): Position | null {
  return positions.find((p) => p.symbol === symbol) ?? null;
}

function closeOrder(position: Position, ctx: RiskContext, source: Signal["source"]): Order {
  return {
    id: ctx.orderId,
    symbol: position.symbol,
    // Closing a long sells; closing a short buys.
    side: position.side === "long" ? "sell" : "buy",
    quantity: position.quantity,
    intent: "close",
    positionSide: position.side,
    stopPrice: null,
    targetPrice: null,
    riskAmount: 0,
    source,
  };
}

/**
 * Size an entry from the risk budget, then clamp it down through every other
 * ceiling. Returns 0 when nothing survives the clamps — the caller turns that
 * into a rejection rather than a 0-quantity order.
 */
export function sizePosition(
  referencePrice: number,
  stopPrice: number,
  equity: number,
  cash: number,
  limits: RiskLimits,
): { quantity: number; riskPerUnit: number } {
  const riskPerUnit = Math.abs(referencePrice - stopPrice);
  if (riskPerUnit <= 0 || referencePrice <= 0 || equity <= 0) return { quantity: 0, riskPerUnit };

  const riskBudget = equity * (limits.maxRiskPerTradePct / 100);
  const byRisk = riskBudget / riskPerUnit;
  const byNotional = (equity * (limits.maxPositionPct / 100)) / referencePrice;
  const byCash = cash / referencePrice;

  return { quantity: Math.floor(Math.min(byRisk, byNotional, byCash)), riskPerUnit };
}

/** Turn a Signal into an Order, or explain why not. */
export function assessSignal(signal: Signal, ctx: RiskContext): RiskDecision {
  const { limits, positions, killSwitch } = ctx;
  // Filled only — what an exit is allowed to act on.
  const existing = findPosition(positions, signal.symbol);
  // Filled plus working — what the "may I open more" checks below must see.
  const working = ctx.working ?? [];
  const committed = [...positions, ...working];
  const committedHere = findPosition(committed, signal.symbol);

  if (signal.action === "hold") {
    return { approved: false, reason: "hold", detail: "signal proposed no action" };
  }

  // Exits are never blocked — not by the kill switch, not by confidence. A halt
  // that traps you in an open position is worse than no halt at all.
  if (signal.action === "exit") {
    if (!existing) {
      return { approved: false, reason: "no_position_to_close", detail: `no open position in ${signal.symbol}` };
    }
    return { approved: true, order: closeOrder(existing, ctx, signal.source) };
  }

  if (killSwitch.tripped) {
    return {
      approved: false,
      reason: "kill_switch_tripped",
      detail: killSwitch.reason ?? "trading halted for the day",
    };
  }

  if (signal.confidence < limits.minConfidence) {
    return {
      approved: false,
      reason: "confidence_below_floor",
      detail: `confidence ${signal.confidence} is below the ${limits.minConfidence} floor`,
    };
  }

  if (committedHere) {
    // No averaging down, no pyramiding: both need rules this harness does not
    // have yet, and silently allowing them would understate real exposure.
    // Working orders count here — otherwise a slow fill lets each new bar's
    // decision stack another full-size order on top of the last.
    const held = existing ? "holding" : "ordered but unfilled:";
    return {
      approved: false,
      reason: "already_in_position",
      detail: `already ${held} ${committedHere.quantity} ${committedHere.side} in ${signal.symbol}`,
    };
  }

  if (committed.length >= limits.maxOpenPositions) {
    return {
      approved: false,
      reason: "position_limit_reached",
      detail: `${committed.length} open or working positions, limit is ${limits.maxOpenPositions}`,
    };
  }

  if (signal.stopPrice === null) {
    return { approved: false, reason: "missing_stop", detail: "entry signals must carry a stop" };
  }

  const side: "long" | "short" = signal.action === "enter_long" ? "long" : "short";
  const stopIsValid =
    side === "long" ? signal.stopPrice < ctx.referencePrice : signal.stopPrice > ctx.referencePrice;
  if (!stopIsValid) {
    return {
      approved: false,
      reason: "stop_on_wrong_side",
      detail: `${side} stop ${signal.stopPrice} is on the wrong side of ${ctx.referencePrice}`,
    };
  }

  const { quantity, riskPerUnit } = sizePosition(
    ctx.referencePrice,
    signal.stopPrice,
    ctx.equity,
    ctx.cash,
    limits,
  );

  if (quantity < 1) {
    const affordable = ctx.cash >= ctx.referencePrice;
    return affordable
      ? {
          approved: false,
          reason: "size_rounds_to_zero",
          detail: `risk budget allows less than one unit at ${ctx.referencePrice}`,
        }
      : {
          approved: false,
          reason: "insufficient_cash",
          detail: `cash ${roundCash(ctx.cash)} cannot buy one unit at ${ctx.referencePrice}`,
        };
  }

  return {
    approved: true,
    order: {
      id: ctx.orderId,
      symbol: signal.symbol,
      side: side === "long" ? "buy" : "sell",
      quantity,
      intent: "open",
      positionSide: side,
      stopPrice: roundPrice(signal.stopPrice),
      targetPrice: signal.targetPrice === null ? null : roundPrice(signal.targetPrice),
      riskAmount: roundCash(quantity * riskPerUnit),
      source: signal.source,
    },
  };
}
