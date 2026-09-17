import { describe, expect, it } from "vitest";
import { createFakeGateway } from "./fake-gateway";
import { createInMemoryOrderStore, type OrderStore } from "./order-store";
import { submitOrder, type SubmitContext } from "./submit";
import type { OrderRecord, OrderRequest } from "./types";

const request = (overrides: Partial<OrderRequest> = {}): OrderRequest => ({
  clientOrderId: "ts-abc123",
  symbol: "EURUSD",
  side: "buy",
  quantity: 1,
  intent: "open",
  stopPrice: 1.15,
  takeProfitPrice: 1.18,
  reason: "test",
  ...overrides,
});

let tick = 0;
const clock = () => `2026-09-15T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const ctx = (gateway: ReturnType<typeof createFakeGateway>, store: OrderStore, extra: Partial<SubmitContext> = {}) => ({
  gateway,
  store,
  now: clock,
  ...extra,
});

describe("normal outcomes", () => {
  it("accepts an order and records the broker's view of it", async () => {
    const gateway = createFakeGateway();
    const store = createInMemoryOrderStore();
    const result = await submitOrder(request(), ctx(gateway, store));

    expect(result.outcome).toBe("accepted");
    expect(result.record.status).toBe("submitted");
    expect(result.record.brokerOrderId).toBe("B1");
    expect(await store.get("ts-abc123")).not.toBeNull();
  });

  it("records a rejection with the broker's reason", async () => {
    const gateway = createFakeGateway({ submitFaults: ["reject"] });
    const result = await submitOrder(request(), ctx(gateway, createInMemoryOrderStore()));

    expect(result.outcome).toBe("rejected");
    expect(result.record.status).toBe("rejected");
    expect(result.record.rejectReason).toBe("insufficient margin");
  });

  it("writes the order to the store BEFORE sending it", async () => {
    // A crash between the write and the send leaves a harmless orphan. The
    // reverse order leaves a live order nothing knows about.
    const order: string[] = [];
    const inner = createInMemoryOrderStore();
    const store: OrderStore = {
      ...inner,
      put: async (record) => {
        order.push(`put:${record.status}`);
        return inner.put(record);
      },
    };
    const gateway = createFakeGateway();
    const spied = { ...gateway, submit: async (r: OrderRequest) => { order.push("submit"); return gateway.submit(r); } };

    await submitOrder(request(), ctx(spied as typeof gateway, store));

    expect(order[0]).toBe("put:pending");
    expect(order[1]).toBe("submit");
  });
});

describe("duplicate prevention", () => {
  it("does not send a second order when asked twice", async () => {
    const gateway = createFakeGateway();
    const store = createInMemoryOrderStore();

    await submitOrder(request(), ctx(gateway, store));
    const second = await submitOrder(request(), ctx(gateway, store));

    expect(second.outcome).toBe("already_known");
    expect(gateway.submitCalls()).toBe(1);
    expect(gateway.orderCount()).toBe(1);
  });

  it("never resends an order that already reached a terminal state", async () => {
    const gateway = createFakeGateway({ submitFaults: ["reject"] });
    const store = createInMemoryOrderStore();

    await submitOrder(request(), ctx(gateway, store));
    const again = await submitOrder(request(), ctx(gateway, store));

    expect(again.outcome).toBe("already_known");
    expect(again.record.status).toBe("rejected");
    expect(gateway.submitCalls()).toBe(1);
  });

  it("treats a venue-side duplicate as the existing order, not a new one", async () => {
    const gateway = createFakeGateway();
    // The broker already holds this id — e.g. a previous run submitted it and
    // this system lost its record entirely.
    await gateway.submit(request());

    const result = await submitOrder(request(), ctx(gateway, createInMemoryOrderStore()));

    expect(result.outcome).toBe("duplicate");
    expect(gateway.orderCount()).toBe(1);
  });
});

describe("ambiguous send — the order may or may not be live", () => {
  it("adopts an order that landed despite the timeout", async () => {
    const gateway = createFakeGateway({ submitFaults: ["timeout_but_lands"] });
    const store = createInMemoryOrderStore();

    const result = await submitOrder(request(), ctx(gateway, store));

    expect(result.outcome).toBe("accepted");
    expect(result.record.status).toBe("submitted");
    expect(gateway.submitCalls()).toBe(1);
    expect(gateway.orderCount()).toBe(1);
  });

  it("concludes an order never landed only after repeated successful 'no such order' answers", async () => {
    const gateway = createFakeGateway({ submitFaults: ["timeout"] });
    const store = createInMemoryOrderStore();

    const result = await submitOrder(request(), ctx(gateway, store, { absenceConfirmations: 2 }));

    expect(result.outcome).toBe("not_at_broker");
    expect(result.record.status).toBe("cancelled");
    expect(result.record.rejectReason).toBe("never reached the broker");
    expect(gateway.orderCount()).toBe(0);
  });

  it("halts rather than guessing when the broker cannot be queried at all", async () => {
    // A failing query returns no information. Treating that as "no such order"
    // is the bug that doubles a position.
    const gateway = createFakeGateway({
      submitFaults: ["timeout_but_lands"],
      getOrderFaults: ["disconnect", "disconnect", "disconnect"],
    });
    const store = createInMemoryOrderStore();

    const result = await submitOrder(request(), ctx(gateway, store, { maxResolveAttempts: 3 }));

    expect(result.outcome).toBe("unresolved");
    if (result.outcome !== "unresolved") return;
    expect(result.halt.reason).toBe("unresolved_order");
    expect((await store.get("ts-abc123"))!.status).toBe("unknown");
  });

  it("does not let a disconnected query masquerade as an absent order", async () => {
    const gateway = createFakeGateway({
      submitFaults: ["timeout"],
      // Two failures then one genuine null: only the null counts toward absence,
      // so with 2 confirmations required this must NOT conclude "not_at_broker".
      getOrderFaults: ["disconnect", "disconnect", "ok"],
    });

    const result = await submitOrder(
      request(),
      ctx(gateway, createInMemoryOrderStore(), { maxResolveAttempts: 3, absenceConfirmations: 2 }),
    );

    expect(result.outcome).toBe("unresolved");
  });
});

describe("restart recovery", () => {
  it("resolves an unknown order on restart instead of submitting a second one", async () => {
    // Round 1: the send times out but the order IS live at the broker, and the
    // resolution queries all fail. The process records "unknown" and halts.
    const gateway = createFakeGateway({
      submitFaults: ["timeout_but_lands"],
      getOrderFaults: ["disconnect", "disconnect"],
    });
    const store = createInMemoryOrderStore();

    const first = await submitOrder(request(), ctx(gateway, store, { maxResolveAttempts: 2 }));
    expect(first.outcome).toBe("unresolved");
    expect(gateway.orderCount()).toBe(1);

    // Round 2: the process restarts. Same store, same derived client order id,
    // connectivity restored. It must recognise the unknown record and query,
    // never submit.
    const second = await submitOrder(request(), ctx(gateway, store));

    expect(second.outcome).toBe("accepted");
    expect(second.record.brokerOrderId).toBe("B1");
    expect(gateway.submitCalls()).toBe(1); // still one — no duplicate was sent
    expect(gateway.orderCount()).toBe(1);
  });

  it("refreshes a live order from the broker on restart rather than resending", async () => {
    const gateway = createFakeGateway();
    const store = createInMemoryOrderStore();
    await submitOrder(request(), ctx(gateway, store));

    // The broker partially fills while this system is down.
    gateway.fill("ts-abc123", 0.4, 1.1612);

    const afterRestart = await submitOrder(request(), ctx(gateway, store));

    expect(afterRestart.outcome).toBe("already_known");
    expect(afterRestart.record.status).toBe("partially_filled");
    expect(afterRestart.record.filledQuantity).toBe(0.4);
    expect(afterRestart.record.averageFillPrice).toBe(1.1612);
    expect(gateway.submitCalls()).toBe(1);
  });

  it("survives a store that already holds a pending record from a crashed run", async () => {
    const orphan: OrderRecord = {
      ...request(),
      status: "pending",
      brokerOrderId: null,
      filledQuantity: 0,
      averageFillPrice: null,
      rejectReason: null,
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
      submitAttempts: 0,
    };
    const store = createInMemoryOrderStore([orphan]);
    const gateway = createFakeGateway();

    const result = await submitOrder(request(), ctx(gateway, store));

    // Still pending locally and absent at the broker: not resent here, left for
    // reconciliation to bury. Nothing was sent.
    expect(result.outcome).toBe("already_known");
    expect(gateway.submitCalls()).toBe(0);
  });
});
