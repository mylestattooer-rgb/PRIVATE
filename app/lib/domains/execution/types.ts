// Live execution types.
//
// Distinct from the simulator domain on purpose. The simulator asks "what would
// have happened"; this domain asks "what is actually true at the broker right
// now, and does my record of it agree". Those need different guarantees: the
// simulator can assume every order fills exactly once, and a live system never
// can.
//
// The governing rule in this domain is **the broker is the source of truth**.
// Local state is a cache that can be wrong, and any disagreement is resolved in
// the broker's favour, loudly.

/** Lifecycle of one order, from this system's point of view. */
export type OrderStatus =
  /** Recorded locally, not yet sent. Crash here = safe, nothing was submitted. */
  | "pending"
  /** Sent and acknowledged by the broker. */
  | "submitted"
  | "partially_filled"
  | "filled"
  | "rejected"
  | "cancelled"
  /** Sent, but the outcome is not known — a timeout, a dropped connection, a
   *  crash between send and record. The dangerous state: the order may or may
   *  not be live at the broker. Never resubmit from here; resolve by querying. */
  | "unknown";

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["filled", "rejected", "cancelled"];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type OrderSide = "buy" | "sell";
export type OrderIntent = "open" | "close";

/** What this system asks the broker to do. `clientOrderId` is derived
 *  deterministically (see client-order-id.ts) and is the idempotency key. */
export type OrderRequest = {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  /** Instrument units — shares, contracts, or lots depending on the venue.
   *  Whatever it is, the gateway and the risk limits must agree on it. */
  quantity: number;
  intent: OrderIntent;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  /** Free-text provenance, logged for replay. Never sent as instructions. */
  reason: string;
};

/** The broker's view of an order. */
export type BrokerOrderState = {
  clientOrderId: string;
  brokerOrderId: string | null;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice: number | null;
  /** Broker-supplied text on a rejection. Untrusted external content. */
  rejectReason: string | null;
  updatedAt: string;
};

/** This system's durable record of an order. Survives restarts. */
export type OrderRecord = OrderRequest & {
  status: OrderStatus;
  brokerOrderId: string | null;
  filledQuantity: number;
  averageFillPrice: number | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Submission attempts made. Used to cap retries on ambiguous outcomes, never
   *  to justify re-sending an order whose fate is unknown. */
  submitAttempts: number;
};

export type BrokerPosition = {
  symbol: string;
  /** Signed: positive is long, negative is short. A single signed number rather
   *  than side+quantity, because that is how a netting account actually behaves
   *  and it makes "flat" unambiguous (0, not an absent record). */
  quantity: number;
  averagePrice: number;
};

export type BrokerAccount = {
  currency: string;
  balance: number;
  equity: number;
  /** Margin currently committed. null on venues that do not report it. */
  usedMargin: number | null;
  /** Broker-reported leverage, e.g. 30 for 1:30. null if unknown. */
  leverage: number | null;
};

/** Why the system is refusing to open new positions. Exits are never gated. */
export type HaltReason =
  | "not_reconciled"
  | "reconciliation_discrepancy"
  | "unresolved_order"
  | "connectivity"
  | "stale_data"
  | "risk_limit"
  | "manual_kill_switch";

export type Halt = { reason: HaltReason; detail: string; since: string };
