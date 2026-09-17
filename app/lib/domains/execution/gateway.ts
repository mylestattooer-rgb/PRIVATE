// The broker connection interface.
//
// Every real venue adapter (MetaTrader 5 bridge, Alpaca, IBKR) implements this
// and nothing else in the system talks to a broker. Two properties are
// load-bearing:
//
//   * `submit` reports "unknown" rather than throwing on a timeout or dropped
//     connection. A thrown error invites a retry, and retrying an order whose
//     fate you do not know is how accounts get doubled. "unknown" forces the
//     caller into the resolution path instead.
//   * `getOrder` looks an order up by CLIENT order id, not broker order id. On
//     restart the broker id may never have been recorded, so the client id is
//     the only handle that always survives.

import type { BrokerAccount, BrokerOrderState, BrokerPosition, OrderRequest } from "./types";

export type SubmitOutcome =
  | { kind: "accepted"; state: BrokerOrderState }
  | { kind: "rejected"; state: BrokerOrderState }
  /** The broker recognised the client order id and did NOT create a second
   *  order. The correct, boring response to a duplicate submission. */
  | { kind: "duplicate"; state: BrokerOrderState }
  /** Outcome genuinely not known. The order may or may not be live. */
  | { kind: "unknown"; error: string };

export type CancelOutcome = { ok: boolean; detail: string };

export type BrokerGateway = {
  readonly name: string;
  /** True when this gateway transacts with real funds at a real venue. Every
   *  guard in the system keys off this. */
  readonly isLive: boolean;

  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  /** Null when the broker has no record of this client order id. */
  getOrder(clientOrderId: string): Promise<BrokerOrderState | null>;
  submit(request: OrderRequest): Promise<SubmitOutcome>;
  cancel(clientOrderId: string): Promise<CancelOutcome>;
};

/** Raised when a live gateway is handed to something that must never touch one. */
export class LiveGatewayRefusedError extends Error {
  constructor(gatewayName: string, context: string) {
    super(`${context} refused live gateway "${gatewayName}".`);
    this.name = "LiveGatewayRefusedError";
  }
}
