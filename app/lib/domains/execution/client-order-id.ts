// Deterministic idempotency keys.
//
// This is the single mechanism preventing duplicate orders, so it is worth
// being precise about why it works. The id is a hash of the *decision*, not of
// the moment of sending. If the process crashes between sending an order and
// recording that it sent one, the restarted process re-derives a byte-identical
// id for the same decision, asks the broker "do you already have this?", and
// adopts the existing order instead of sending a second one.
//
// A random or timestamp-based id would produce a different value on restart and
// would therefore double the position. That failure mode is the reason this
// file exists.

import { createHash } from "node:crypto";
import type { OrderIntent, OrderSide } from "./types";

export type OrderIdentity = {
  strategy: string;
  symbol: string;
  /** ISO timestamp of the BAR the decision was made on — not `Date.now()`.
   *  Re-running the same decision must produce the same id. */
  decisionTime: string;
  intent: OrderIntent;
  side: OrderSide;
  /** Distinguishes multiple orders arising from one decision (scaling out, a
   *  deliberate second attempt after a confirmed rejection). Defaults to 0. */
  sequence?: number;
};

/** Brokers cap client order id length — MT5's order comment field is famously
 *  short. 19 characters fits everywhere this is likely to run. */
export const MAX_CLIENT_ORDER_ID_LENGTH = 32;

export function deriveClientOrderId(identity: OrderIdentity, prefix = "ts"): string {
  if (!/^[a-zA-Z0-9]{1,8}$/.test(prefix)) {
    throw new Error(`deriveClientOrderId: prefix must be 1-8 alphanumeric characters, got "${prefix}"`);
  }

  // JSON encoding rather than string concatenation: it is unambiguous, so
  // ("AB", "C") and ("A", "BC") can never collide into the same digest.
  const canonical = JSON.stringify([
    identity.strategy,
    identity.symbol.toUpperCase(),
    identity.decisionTime,
    identity.intent,
    identity.side,
    identity.sequence ?? 0,
  ]);

  const digest = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
  const id = `${prefix}-${digest}`;

  if (id.length > MAX_CLIENT_ORDER_ID_LENGTH) {
    throw new Error(`deriveClientOrderId: produced an id longer than ${MAX_CLIENT_ORDER_ID_LENGTH}`);
  }

  return id;
}
