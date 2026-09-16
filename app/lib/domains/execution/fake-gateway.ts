// A programmable broker for tests.
//
// This is not a simulator of market behaviour — that is the simulator domain's
// job. This models the ways a broker CONNECTION misbehaves: timeouts that leave
// an order live, timeouts that do not, rejections, partial fills, and a
// getOrder that is itself unreachable.
//
// `timeout_but_lands` is the one that matters. It is the failure that duplicates
// positions in real systems, and it is invisible to the caller: the submit call
// looks identical to `timeout`, but the order exists at the broker afterwards.

import type { BrokerGateway, CancelOutcome, SubmitOutcome } from "./gateway";
import type { BrokerAccount, BrokerOrderState, BrokerPosition, OrderRequest } from "./types";

export type SubmitFault = "ok" | "reject" | "timeout" | "timeout_but_lands" | "disconnect";
export type QueryFault = "ok" | "disconnect";

export type FakeGatewayOptions = {
  isLive?: boolean;
  account?: Partial<BrokerAccount>;
  positions?: BrokerPosition[];
  /** Consumed one per submit() call. Exhausted means "ok" from then on. */
  submitFaults?: SubmitFault[];
  /** Consumed one per getOrder() call. Exhausted means "ok". */
  getOrderFaults?: QueryFault[];
  /** Consumed one per getPositions() call. Exhausted means "ok". */
  getPositionsFaults?: QueryFault[];
  clock?: () => string;
};

export type FakeGateway = BrokerGateway & {
  /** Advance an order the broker holds, as a venue would. */
  fill(clientOrderId: string, quantity: number, price: number): void;
  setPositions(positions: BrokerPosition[]): void;
  /** How many times submit() was called — the duplicate-order canary. */
  submitCalls(): number;
  /** How many distinct orders actually exist at the "broker". */
  orderCount(): number;
  orders(): BrokerOrderState[];
};

const DEFAULT_ACCOUNT: BrokerAccount = {
  currency: "USD",
  balance: 10_000,
  equity: 10_000,
  usedMargin: 0,
  leverage: 30,
};

export function createFakeGateway(options: FakeGatewayOptions = {}): FakeGateway {
  const clock = options.clock ?? (() => new Date().toISOString());
  const account: BrokerAccount = { ...DEFAULT_ACCOUNT, ...options.account };
  let positions: BrokerPosition[] = options.positions ? [...options.positions] : [];

  const orders = new Map<string, BrokerOrderState>();
  const submitFaults = [...(options.submitFaults ?? [])];
  const getOrderFaults = [...(options.getOrderFaults ?? [])];
  const getPositionsFaults = [...(options.getPositionsFaults ?? [])];

  let submitCalls = 0;
  let brokerIdSeq = 0;

  const create = (request: OrderRequest, status: BrokerOrderState["status"], rejectReason: string | null = null) => {
    const state: BrokerOrderState = {
      clientOrderId: request.clientOrderId,
      brokerOrderId: `B${++brokerIdSeq}`,
      status,
      filledQuantity: 0,
      averageFillPrice: null,
      rejectReason,
      updatedAt: clock(),
    };
    orders.set(request.clientOrderId, state);
    return state;
  };

  return {
    name: "fake",
    isLive: options.isLive ?? false,

    async getAccount() {
      return { ...account };
    },

    async getPositions() {
      if (getPositionsFaults.shift() === "disconnect") {
        throw new Error("fake gateway: disconnected");
      }
      return positions.map((p) => ({ ...p }));
    },

    async getOrder(clientOrderId) {
      if (getOrderFaults.shift() === "disconnect") {
        throw new Error("fake gateway: disconnected");
      }
      const found = orders.get(clientOrderId);
      return found ? { ...found } : null;
    },

    async submit(request): Promise<SubmitOutcome> {
      submitCalls++;
      const fault = submitFaults.shift() ?? "ok";

      // Idempotency at the venue: a broker that recognises the client order id
      // returns the existing order rather than creating a second one. Not every
      // broker does this, which is exactly why this system keeps its own store
      // and never relies on the venue alone.
      const existing = orders.get(request.clientOrderId);
      if (existing && fault !== "timeout" && fault !== "disconnect") {
        return { kind: "duplicate", state: { ...existing } };
      }

      switch (fault) {
        case "reject":
          return { kind: "rejected", state: create(request, "rejected", "insufficient margin") };
        case "timeout":
          // Never arrived.
          return { kind: "unknown", error: "request timed out" };
        case "timeout_but_lands":
          // Arrived and is live, but the caller was never told.
          create(request, "submitted");
          return { kind: "unknown", error: "request timed out" };
        case "disconnect":
          return { kind: "unknown", error: "connection reset" };
        default:
          return { kind: "accepted", state: create(request, "submitted") };
      }
    },

    async cancel(clientOrderId): Promise<CancelOutcome> {
      const found = orders.get(clientOrderId);
      if (!found) return { ok: false, detail: "no such order" };
      orders.set(clientOrderId, { ...found, status: "cancelled", updatedAt: clock() });
      return { ok: true, detail: "cancelled" };
    },

    fill(clientOrderId, quantity, price) {
      const found = orders.get(clientOrderId);
      if (!found) throw new Error(`fake gateway: cannot fill unknown order ${clientOrderId}`);
      const filled = found.filledQuantity + quantity;
      orders.set(clientOrderId, {
        ...found,
        filledQuantity: filled,
        averageFillPrice: price,
        status: "partially_filled",
        updatedAt: clock(),
      });
    },

    setPositions(next) {
      positions = next.map((p) => ({ ...p }));
    },

    submitCalls: () => submitCalls,
    orderCount: () => orders.size,
    orders: () => [...orders.values()].map((o) => ({ ...o })),
  };
}
