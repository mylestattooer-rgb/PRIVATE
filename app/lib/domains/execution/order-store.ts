// Durable record of every order this system has ever intended to place.
//
// The write ordering matters more than the storage engine: an order is recorded
// as "pending" BEFORE it is sent. A crash between the record and the send leaves
// a pending order with no broker counterpart, which reconciliation resolves
// harmlessly. The reverse ordering — send, then record — leaves an order live at
// the broker that this system has no memory of, which is the failure that loses
// money.
//
// The in-memory implementation below is for tests. A Prisma-backed
// implementation satisfies the same interface; nothing above this file knows
// which one it has.

import type { OrderRecord, OrderStatus } from "./types";

export type OrderStore = {
  get(clientOrderId: string): Promise<OrderRecord | null>;
  put(record: OrderRecord): Promise<void>;
  /** Orders that have not reached a terminal status. These are what
   *  reconciliation has to resolve on startup. */
  openOrders(): Promise<OrderRecord[]>;
  all(): Promise<OrderRecord[]>;
};

export function createInMemoryOrderStore(seed: OrderRecord[] = []): OrderStore {
  const records = new Map<string, OrderRecord>(seed.map((r) => [r.clientOrderId, r]));

  return {
    async get(clientOrderId) {
      const found = records.get(clientOrderId);
      // Copy on read: callers must not be able to mutate stored state by
      // holding on to a returned object, which a real database would never let
      // them do either.
      return found ? { ...found } : null;
    },
    async put(record) {
      records.set(record.clientOrderId, { ...record });
    },
    async openOrders() {
      const open: OrderStatus[] = ["pending", "submitted", "partially_filled", "unknown"];
      return [...records.values()].filter((r) => open.includes(r.status)).map((r) => ({ ...r }));
    },
    async all() {
      return [...records.values()].map((r) => ({ ...r }));
    },
  };
}
