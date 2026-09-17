// Idempotent order submission.
//
// The hard case this file exists for is not a rejection — rejections are easy,
// the broker told you what happened. It is the **ambiguous send**: the request
// timed out, or the connection dropped, or the process died mid-call. The order
// may be live at the broker or may never have arrived, and the two look
// identical from here.
//
// The wrong response is to retry. The right response is to ask.
//
// Resolution has exactly three outcomes, and they are deliberately distinct:
//
//   found         the broker has the order -> adopt its state. Definitive.
//   absent        several *successful* queries all say no such order -> it never
//                 landed. Definitive enough to mark the order dead.
//   unresolvable  the queries themselves are failing -> we know nothing, so the
//                 system halts new trading rather than guessing.
//
// Collapsing "absent" and "unresolvable" into one branch is the bug that doubles
// a position: a failing query returns nothing, which looks exactly like "no such
// order" if you are not careful to distinguish a null answer from no answer.

import type { BrokerGateway } from "./gateway";
import type { OrderStore } from "./order-store";
import type { BrokerOrderState, Halt, OrderRecord, OrderRequest } from "./types";
import { isTerminal } from "./types";

export type SubmitContext = {
  gateway: BrokerGateway;
  store: OrderStore;
  /** Injected so tests are deterministic and logs are replayable. */
  now: () => string;
  /** Consecutive successful "no such order" answers required before concluding
   *  the order never reached the broker. More than one, because an order can be
   *  briefly in flight and not yet visible. */
  absenceConfirmations?: number;
  /** Total getOrder attempts allowed while resolving. */
  maxResolveAttempts?: number;
};

export type SubmitResult =
  | { outcome: "accepted"; record: OrderRecord }
  | { outcome: "rejected"; record: OrderRecord }
  /** The broker already had this client order id. No second order was created. */
  | { outcome: "duplicate"; record: OrderRecord }
  /** This system already had a live or terminal record. Nothing was sent. */
  | { outcome: "already_known"; record: OrderRecord }
  /** Confirmed never to have reached the broker. Safe to re-decide later. */
  | { outcome: "not_at_broker"; record: OrderRecord }
  /** Fate unknown and unknowable right now. The caller must halt. */
  | { outcome: "unresolved"; record: OrderRecord; halt: Halt };

function newRecord(request: OrderRequest, now: string): OrderRecord {
  return {
    ...request,
    status: "pending",
    brokerOrderId: null,
    filledQuantity: 0,
    averageFillPrice: null,
    rejectReason: null,
    createdAt: now,
    updatedAt: now,
    submitAttempts: 0,
  };
}

function merge(record: OrderRecord, state: BrokerOrderState, now: string): OrderRecord {
  return {
    ...record,
    status: state.status,
    brokerOrderId: state.brokerOrderId,
    filledQuantity: state.filledQuantity,
    averageFillPrice: state.averageFillPrice,
    rejectReason: state.rejectReason,
    updatedAt: now,
  };
}

/**
 * Resolve an order whose submission outcome is unknown.
 *
 * Note the two separate counters. `attempts` bounds total work; `absences`
 * counts only *successful* queries that returned null. A query that throws
 * advances the first and not the second, which is what keeps a broken
 * connection from being mistaken for a missing order.
 */
async function resolve(
  record: OrderRecord,
  ctx: SubmitContext,
): Promise<{ state: BrokerOrderState | null; definitive: boolean }> {
  const maxAttempts = ctx.maxResolveAttempts ?? 5;
  const needed = ctx.absenceConfirmations ?? 2;
  let absences = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let state: BrokerOrderState | null;
    try {
      state = await ctx.gateway.getOrder(record.clientOrderId);
    } catch {
      // No answer is not the same as an answer of "no".
      continue;
    }

    if (state) return { state, definitive: true };

    absences++;
    if (absences >= needed) return { state: null, definitive: true };
  }

  return { state: null, definitive: false };
}

/**
 * Submit an order at most once, ever, for a given client order id.
 *
 * The order is written to the store as "pending" BEFORE it is sent. A crash
 * between the write and the send leaves a harmless orphan record; a crash
 * between the send and the write would leave an unknown live order, which is
 * why the ordering is not negotiable.
 */
export async function submitOrder(
  request: OrderRequest,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  const { gateway, store } = ctx;
  const existing = await store.get(request.clientOrderId);

  if (existing) {
    if (isTerminal(existing.status)) {
      return { outcome: "already_known", record: existing };
    }

    if (existing.status === "unknown") {
      return finishResolution(existing, ctx);
    }

    // Already submitted or partially filled. Refresh from the broker rather
    // than sending anything; the broker's view supersedes ours.
    try {
      const state = await gateway.getOrder(existing.clientOrderId);
      if (state) {
        const updated = merge(existing, state, ctx.now());
        await store.put(updated);
        return { outcome: "already_known", record: updated };
      }
    } catch {
      // Fall through — a failed refresh does not change what we know.
    }
    return { outcome: "already_known", record: existing };
  }

  // Record intent before acting on it.
  const pending = newRecord(request, ctx.now());
  await store.put(pending);

  const attempted: OrderRecord = { ...pending, submitAttempts: 1, updatedAt: ctx.now() };
  const outcome = await gateway.submit(request);

  if (outcome.kind === "accepted" || outcome.kind === "rejected" || outcome.kind === "duplicate") {
    const updated = merge(attempted, outcome.state, ctx.now());
    await store.put(updated);
    return {
      outcome: outcome.kind === "duplicate" ? "duplicate" : outcome.kind === "rejected" ? "rejected" : "accepted",
      record: updated,
    };
  }

  // Unknown. Persist that fact before resolving, so a crash during resolution
  // restarts into the resolution path rather than into a fresh submission.
  const unknown: OrderRecord = { ...attempted, status: "unknown", updatedAt: ctx.now() };
  await store.put(unknown);
  return finishResolution(unknown, ctx);
}

async function finishResolution(record: OrderRecord, ctx: SubmitContext): Promise<SubmitResult> {
  const { state, definitive } = await resolve(record, ctx);

  if (state) {
    const updated = merge(record, state, ctx.now());
    await ctx.store.put(updated);
    return {
      outcome: updated.status === "rejected" ? "rejected" : "accepted",
      record: updated,
    };
  }

  if (definitive) {
    const dead: OrderRecord = {
      ...record,
      status: "cancelled",
      rejectReason: "never reached the broker",
      updatedAt: ctx.now(),
    };
    await ctx.store.put(dead);
    return { outcome: "not_at_broker", record: dead };
  }

  return {
    outcome: "unresolved",
    record,
    halt: {
      reason: "unresolved_order",
      detail:
        `order ${record.clientOrderId} (${record.side} ${record.quantity} ${record.symbol}) ` +
        `may or may not be live at the broker; the broker could not be queried`,
      since: ctx.now(),
    },
  };
}
