import { describe, expect, it } from "vitest";
import {
  applySlippage,
  computeCommission,
  createIdealBroker,
  createPaperBroker,
  DEFAULT_COMMISSION,
  ZERO_COMMISSION,
} from "./broker";
import type { Bar, Order } from "./types";

const bar: Bar = { time: "2026-01-02T00:00:00.000Z", open: 100, high: 105, low: 95, close: 102, volume: 1_000 };

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o-1",
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  intent: "open",
  positionSide: "long",
  stopPrice: 90,
  targetPrice: 120,
  riskAmount: 100,
  source: "rule",
  ...overrides,
});

describe("applySlippage", () => {
  it("always works against the order", () => {
    expect(applySlippage(100, "buy", 50)).toBe(100.5);
    expect(applySlippage(100, "sell", 50)).toBe(99.5);
  });

  it("is a no-op at zero", () => {
    expect(applySlippage(100, "buy", 0)).toBe(100);
  });
});

describe("computeCommission", () => {
  it("applies a per-unit fee", () => {
    expect(computeCommission(100, 50, { perUnit: 0.005, percentOfNotional: 0, minimum: 0 })).toBe(0.5);
  });

  it("applies a percentage of notional", () => {
    expect(computeCommission(10, 100, { perUnit: 0, percentOfNotional: 0.1, minimum: 0 })).toBe(1);
  });

  it("enforces the minimum", () => {
    expect(computeCommission(1, 10, DEFAULT_COMMISSION)).toBe(1);
  });

  it("is zero under the zero model", () => {
    expect(computeCommission(100, 100, ZERO_COMMISSION)).toBe(0);
  });
});

describe("paper broker", () => {
  it("declares itself non-live", () => {
    expect(createPaperBroker().isLive).toBe(false);
    expect(createIdealBroker().isLive).toBe(false);
  });

  it("fills at the bar open plus slippage and charges commission", async () => {
    const broker = createPaperBroker({ slippageBps: 10, commission: DEFAULT_COMMISSION });
    const fill = await broker.submit(order(), { bar });

    expect(fill).not.toBeNull();
    expect(fill!.price).toBeCloseTo(100.1, 6);
    expect(fill!.slippage).toBeCloseTo(0.1, 6);
    expect(fill!.time).toBe(bar.time);
    expect(fill!.commission).toBeGreaterThan(0);
  });

  it("fills a sell below the open", async () => {
    const broker = createPaperBroker({ slippageBps: 10, commission: ZERO_COMMISSION });
    const fill = await broker.submit(order({ side: "sell" }), { bar });
    expect(fill!.price).toBeCloseTo(99.9, 6);
  });

  it("honours an explicit fill price for a resting stop", async () => {
    const broker = createPaperBroker({ slippageBps: 0, commission: ZERO_COMMISSION });
    const fill = await broker.submit(order({ side: "sell", intent: "close" }), { bar, fillPrice: 90 });
    expect(fill!.price).toBe(90);
  });

  it("carries order identity and intent onto the fill", async () => {
    const fill = await createIdealBroker().submit(order({ id: "o-42", intent: "close" }), { bar });
    expect(fill!.orderId).toBe("o-42");
    expect(fill!.intent).toBe("close");
    expect(fill!.quantity).toBe(10);
  });

  it("returns null rather than filling at a nonsensical price", async () => {
    const broken = { ...bar, open: 0 };
    expect(await createIdealBroker().submit(order(), { bar: broken })).toBeNull();
  });

  it("fills at exactly the reference price under the ideal broker", async () => {
    const fill = await createIdealBroker().submit(order(), { bar });
    expect(fill!.price).toBe(100);
    expect(fill!.commission).toBe(0);
    expect(fill!.slippage).toBe(0);
  });
});
