// Restart recovery.
//
// One rule: **the broker is the source of truth.** This system's records are a
// cache, and a cache that disagrees with the venue is wrong by definition. A
// process that restarts and trusts its own memory will eventually hold a
// position it does not know about, or believe in one that was closed while it
// was down.
//
// Reconciliation runs before anything else on startup and answers one question:
// is it safe to trade? It is allowed to answer "no". Refusing to open new
// positions costs an opportunity; trading on a wrong position costs money.
//
// Local position is DERIVED from recorded fills rather than stored as its own
// mutable number. A stored position is a second source of truth that can drift
// silently from the fills that produced it; a derived one cannot.

import type { BrokerGateway } from "./gateway";
import type { OrderStore } from "./order-store";
import type { BrokerPosition, Halt, OrderRecord } from "./types";
import { isTerminal } from "./types";

/** Lot sizes go to 0.01, so quantities are compared with a tolerance well below
 *  the smallest tradeable increment rather than with ===. */
const QUANTITY_EPSILON = 1e-9;

export type DiscrepancyKind =
  /** The broker holds a position this system has no record of. */
  | "unknown_broker_position"
  /** This system believes in a position the broker does not hold. */
  | "missing_broker_position"
  | "quantity_mismatch"
  /** An order whose fate could not be determined. */
  | "unresolved_order"
  /** Recorded as pending but never sent. Harmless; cleaned up. */
  | "orphan_pending_order";

export type Discrepancy = {
  kind: DiscrepancyKind;
  symbol: string | null;
  detail: string;
  /** Blocking discrepancies stop new positions being opened. Exits are never
   *  blocked — being unable to close is strictly worse than being unable to open. */
  blocking: boolean;
};

export type PositionQuantity = { symbol: string; quantity: number };

export type ReconciliationReport = {
  at: string;
  /** False when broker state could not be read at all. */
  reconciled: boolean;
  brokerPositions: BrokerPosition[];
  localPositions: PositionQuantity[];
  /**
   * Signed quantity still WORKING at the broker — ordered but not yet filled.
   *
   * Carried in the report rather than left for callers to derive, because a
   * caller that forgets it silently loses its position limits. Measured: with
   * one order per cycle and slow fills, three cycles put three full-size orders
   * on the book — 30 units against a 10-unit intent — while every risk check
   * passed, because both layers sized against filled positions only. The
   * client-order-id guard does not help: it stops the SAME decision being sent
   * twice, and each cycle's new bar makes a genuinely new decision.
   *
   * Risk limits must treat this as though it were already filled. It is the
   * worst case, and worst case is the only safe assumption for a limit.
   */
  workingQuantities: PositionQuantity[];
  discrepancies: Discrepancy[];
  halt: Halt | null;
};

export type ReconcileContext = {
  gateway: BrokerGateway;
  store: OrderStore;
  now: () => string;
};

/**
 * Net position per symbol, derived purely from recorded fills.
 *
 * Signed rather than side + quantity: it is how a netting account behaves, and
 * it makes "flat" unambiguously zero instead of an absent record.
 */
export function derivePositionsFromOrders(records: OrderRecord[]): PositionQuantity[] {
  const bySymbol = new Map<string, number>();

  for (const record of records) {
    if (record.filledQuantity === 0) continue;
    const signed = record.side === "buy" ? record.filledQuantity : -record.filledQuantity;
    bySymbol.set(record.symbol, (bySymbol.get(record.symbol) ?? 0) + signed);
  }

  return [...bySymbol.entries()]
    .filter(([, quantity]) => Math.abs(quantity) > QUANTITY_EPSILON)
    .map(([symbol, quantity]) => ({ symbol, quantity }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Signed quantity ordered but not yet filled, per symbol.
 *
 * Non-terminal orders only: a filled, rejected or cancelled order has no
 * residual. Signed the same way as `derivePositionsFromOrders`, so a working
 * BUY adds exposure and a working SELL removes it — which is what keeps this
 * from ever blocking an exit, since a close order's residual pushes the number
 * toward flat rather than away from it.
 */
export function deriveWorkingQuantities(records: OrderRecord[]): PositionQuantity[] {
  const bySymbol = new Map<string, number>();

  for (const record of records) {
    if (isTerminal(record.status)) continue;
    const residual = record.quantity - record.filledQuantity;
    if (residual <= 0) continue;
    const signed = record.side === "buy" ? residual : -residual;
    bySymbol.set(record.symbol, (bySymbol.get(record.symbol) ?? 0) + signed);
  }

  return [...bySymbol.entries()]
    .filter(([, quantity]) => Math.abs(quantity) > QUANTITY_EPSILON)
    .map(([symbol, quantity]) => ({ symbol, quantity }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function reconcile(ctx: ReconcileContext): Promise<ReconciliationReport> {
  const at = ctx.now();
  const discrepancies: Discrepancy[] = [];

  let brokerPositions: BrokerPosition[];
  try {
    brokerPositions = await ctx.gateway.getPositions();
  } catch (error) {
    // Could not read the venue at all. This is not a discrepancy, it is a
    // blackout: nothing can be asserted about anything.
    return {
      at,
      reconciled: false,
      brokerPositions: [],
      localPositions: [],
      workingQuantities: [],
      discrepancies: [],
      halt: {
        reason: "connectivity",
        detail: `could not read broker positions: ${error instanceof Error ? error.message : String(error)}`,
        since: at,
      },
    };
  }

  // Settle every order that has not reached a terminal state, so the position
  // derivation below is based on final fill data rather than stale records.
  for (const record of await ctx.store.openOrders()) {
    let state = null;
    try {
      state = await ctx.gateway.getOrder(record.clientOrderId);
    } catch {
      state = null;
    }

    if (state) {
      await ctx.store.put({
        ...record,
        status: state.status,
        brokerOrderId: state.brokerOrderId,
        filledQuantity: state.filledQuantity,
        averageFillPrice: state.averageFillPrice,
        rejectReason: state.rejectReason,
        updatedAt: at,
      });
      if (!isTerminal(state.status) && state.status === "unknown") {
        discrepancies.push({
          kind: "unresolved_order",
          symbol: record.symbol,
          detail: `order ${record.clientOrderId} is in an unknown state at the broker`,
          blocking: true,
        });
      }
      continue;
    }

    if (record.status === "pending") {
      // Recorded before sending, then the process died. Never reached the
      // venue, so it is safe to bury.
      await ctx.store.put({
        ...record,
        status: "cancelled",
        rejectReason: "orphaned before submission",
        updatedAt: at,
      });
      discrepancies.push({
        kind: "orphan_pending_order",
        symbol: record.symbol,
        detail: `order ${record.clientOrderId} was recorded but never submitted; discarded`,
        blocking: false,
      });
      continue;
    }

    discrepancies.push({
      kind: "unresolved_order",
      symbol: record.symbol,
      detail:
        `order ${record.clientOrderId} was ${record.status} locally but the broker has no record of it`,
      blocking: true,
    });
  }

  const localPositions = derivePositionsFromOrders(await ctx.store.all());
  // A signed quantity of 0 is flat. Brokers report flat symbols either by
  // omitting them or by returning a zero row, and treating the zero row as a
  // position invents a discrepancy against local records that correctly hold
  // nothing.
  const brokerBySymbol = new Map(
    brokerPositions.filter((p) => Math.abs(p.quantity) > QUANTITY_EPSILON).map((p) => [p.symbol, p]),
  );
  const localBySymbol = new Map(localPositions.map((p) => [p.symbol, p]));

  for (const [symbol, broker] of brokerBySymbol) {
    const local = localBySymbol.get(symbol);
    if (!local) {
      discrepancies.push({
        kind: "unknown_broker_position",
        symbol,
        detail: `broker holds ${broker.quantity} ${symbol} that this system has no record of`,
        blocking: true,
      });
    } else if (Math.abs(local.quantity - broker.quantity) > QUANTITY_EPSILON) {
      discrepancies.push({
        kind: "quantity_mismatch",
        symbol,
        detail: `broker holds ${broker.quantity} ${symbol}, this system recorded ${local.quantity}`,
        blocking: true,
      });
    }
  }

  for (const [symbol, local] of localBySymbol) {
    if (!brokerBySymbol.has(symbol)) {
      discrepancies.push({
        kind: "missing_broker_position",
        symbol,
        detail: `this system recorded ${local.quantity} ${symbol} but the broker holds none`,
        blocking: true,
      });
    }
  }

  const blocking = discrepancies.filter((d) => d.blocking);

  // Read AFTER the settle loop above, so residuals reflect the broker's latest
  // fill data rather than whatever was cached at cycle start.
  const workingQuantities = deriveWorkingQuantities(await ctx.store.all());

  return {
    at,
    reconciled: true,
    brokerPositions,
    localPositions,
    workingQuantities,
    discrepancies,
    halt:
      blocking.length === 0
        ? null
        : {
            reason: "reconciliation_discrepancy",
            detail: `${blocking.length} blocking discrepancy(ies): ${blocking.map((d) => d.detail).join("; ")}`,
            since: at,
          },
  };
}
