import { describe, expect, it } from "vitest";
import { createFakeGateway } from "./fake-gateway";
import { createInMemoryOrderStore } from "./order-store";
import { derivePositionsFromOrders, reconcile } from "./reconcile";
import type { OrderRecord, OrderStatus } from "./types";

const record = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  clientOrderId: "ts-1",
  symbol: "EURUSD",
  side: "buy",
  quantity: 1,
  intent: "open",
  stopPrice: null,
  takeProfitPrice: null,
  reason: "test",
  status: "filled" as OrderStatus,
  brokerOrderId: "B1",
  filledQuantity: 1,
  averageFillPrice: 1.16,
  rejectReason: null,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  submitAttempts: 1,
  ...overrides,
});

const now = () => "2026-09-16T00:00:00.000Z";

describe("derivePositionsFromOrders", () => {
  it("nets buys against sells", () => {
    expect(
      derivePositionsFromOrders([
        record({ clientOrderId: "a", side: "buy", filledQuantity: 3 }),
        record({ clientOrderId: "b", side: "sell", filledQuantity: 1 }),
      ]),
    ).toEqual([{ symbol: "EURUSD", quantity: 2 }]);
  });

  it("reports nothing when a position has been fully closed", () => {
    expect(
      derivePositionsFromOrders([
        record({ clientOrderId: "a", side: "buy", filledQuantity: 2 }),
        record({ clientOrderId: "b", side: "sell", filledQuantity: 2, intent: "close" }),
      ]),
    ).toEqual([]);
  });

  it("represents a short as a negative quantity", () => {
    expect(derivePositionsFromOrders([record({ side: "sell", filledQuantity: 2 })])).toEqual([
      { symbol: "EURUSD", quantity: -2 },
    ]);
  });

  it("ignores orders that never filled", () => {
    expect(
      derivePositionsFromOrders([record({ status: "rejected", filledQuantity: 0 })]),
    ).toEqual([]);
  });

  it("counts partial fills at the quantity actually filled", () => {
    expect(
      derivePositionsFromOrders([record({ status: "partially_filled", quantity: 5, filledQuantity: 2 })]),
    ).toEqual([{ symbol: "EURUSD", quantity: 2 }]);
  });
});

describe("reconcile", () => {
  it("is clean when the broker is flat and nothing was ever traded", async () => {
    const report = await reconcile({
      gateway: createFakeGateway(),
      store: createInMemoryOrderStore(),
      now,
    });

    expect(report.reconciled).toBe(true);
    expect(report.discrepancies).toEqual([]);
    expect(report.halt).toBeNull();
  });

  it("is clean when local records and broker positions agree", async () => {
    const report = await reconcile({
      gateway: createFakeGateway({ positions: [{ symbol: "EURUSD", quantity: 1, averagePrice: 1.16 }] }),
      store: createInMemoryOrderStore([record()]),
      now,
    });

    expect(report.halt).toBeNull();
    expect(report.localPositions).toEqual([{ symbol: "EURUSD", quantity: 1 }]);
  });

  it("halts on a broker position this system has never heard of", async () => {
    const report = await reconcile({
      gateway: createFakeGateway({ positions: [{ symbol: "GBPUSD", quantity: 2, averagePrice: 1.3 }] }),
      store: createInMemoryOrderStore(),
      now,
    });

    expect(report.discrepancies[0].kind).toBe("unknown_broker_position");
    expect(report.discrepancies[0].blocking).toBe(true);
    expect(report.halt?.reason).toBe("reconciliation_discrepancy");
  });

  it("halts when this system believes in a position the broker does not hold", async () => {
    // The position was closed manually, or by a stop, while this system was down.
    const report = await reconcile({
      gateway: createFakeGateway({ positions: [] }),
      store: createInMemoryOrderStore([record()]),
      now,
    });

    expect(report.discrepancies[0].kind).toBe("missing_broker_position");
    expect(report.halt).not.toBeNull();
  });

  it("halts on a quantity mismatch and reports both numbers", async () => {
    const report = await reconcile({
      gateway: createFakeGateway({ positions: [{ symbol: "EURUSD", quantity: 3, averagePrice: 1.16 }] }),
      store: createInMemoryOrderStore([record({ filledQuantity: 1 })]),
      now,
    });

    expect(report.discrepancies[0].kind).toBe("quantity_mismatch");
    expect(report.discrepancies[0].detail).toContain("broker holds 3");
    expect(report.discrepancies[0].detail).toContain("recorded 1");
  });

  it("buries an order that was recorded but never submitted, without halting", async () => {
    const store = createInMemoryOrderStore([
      record({ clientOrderId: "ts-orphan", status: "pending", filledQuantity: 0, brokerOrderId: null }),
    ]);

    const report = await reconcile({ gateway: createFakeGateway(), store, now });

    expect(report.discrepancies[0].kind).toBe("orphan_pending_order");
    expect(report.discrepancies[0].blocking).toBe(false);
    expect(report.halt).toBeNull();
    expect((await store.get("ts-orphan"))!.status).toBe("cancelled");
  });

  it("halts on an order that was submitted locally but is absent at the broker", async () => {
    const store = createInMemoryOrderStore([
      record({ clientOrderId: "ts-ghost", status: "submitted", filledQuantity: 0 }),
    ]);

    const report = await reconcile({ gateway: createFakeGateway(), store, now });

    expect(report.discrepancies.some((d) => d.kind === "unresolved_order" && d.blocking)).toBe(true);
    expect(report.halt).not.toBeNull();
  });

  it("adopts the broker's fill data for an order that filled while this system was down", async () => {
    const gateway = createFakeGateway();
    const store = createInMemoryOrderStore();
    await gateway.submit({
      clientOrderId: "ts-1",
      symbol: "EURUSD",
      side: "buy",
      quantity: 1,
      intent: "open",
      stopPrice: null,
      takeProfitPrice: null,
      reason: "test",
    });
    gateway.fill("ts-1", 1, 1.1655);
    gateway.setPositions([{ symbol: "EURUSD", quantity: 1, averagePrice: 1.1655 }]);
    await store.put(record({ status: "submitted", filledQuantity: 0, averageFillPrice: null }));

    const report = await reconcile({ gateway, store, now });

    const updated = await store.get("ts-1");
    expect(updated!.filledQuantity).toBe(1);
    expect(updated!.averageFillPrice).toBe(1.1655);
    expect(report.halt).toBeNull();
  });

  it("refuses to assert anything when the broker cannot be reached", async () => {
    const report = await reconcile({
      gateway: createFakeGateway({ getPositionsFaults: ["disconnect"] }),
      store: createInMemoryOrderStore([record()]),
      now,
    });

    expect(report.reconciled).toBe(false);
    expect(report.halt?.reason).toBe("connectivity");
    // Crucially it does NOT report a missing position — it reports that it does
    // not know, which is a different and honest answer.
    expect(report.discrepancies).toEqual([]);
  });
});
