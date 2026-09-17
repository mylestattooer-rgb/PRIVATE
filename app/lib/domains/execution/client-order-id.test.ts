import { describe, expect, it } from "vitest";
import { deriveClientOrderId, MAX_CLIENT_ORDER_ID_LENGTH, type OrderIdentity } from "./client-order-id";

const identity = (overrides: Partial<OrderIdentity> = {}): OrderIdentity => ({
  strategy: "sma-10/30",
  symbol: "EURUSD",
  decisionTime: "2026-09-15T00:00:00.000Z",
  intent: "open",
  side: "buy",
  ...overrides,
});

describe("deriveClientOrderId", () => {
  it("is deterministic — the same decision always produces the same id", () => {
    expect(deriveClientOrderId(identity())).toBe(deriveClientOrderId(identity()));
  });

  it("is stable across a process restart, which is the whole point", () => {
    // Nothing in the derivation reads a clock, a counter, or a random source.
    const before = deriveClientOrderId(identity());
    const afterSimulatedRestart = deriveClientOrderId(identity());
    expect(afterSimulatedRestart).toBe(before);
  });

  it("changes when any part of the decision changes", () => {
    const base = deriveClientOrderId(identity());
    const variants: Partial<OrderIdentity>[] = [
      { strategy: "sma-10/31" },
      { symbol: "GBPUSD" },
      { decisionTime: "2026-09-16T00:00:00.000Z" },
      { intent: "close" },
      { side: "sell" },
      { sequence: 1 },
    ];
    for (const variant of variants) {
      expect(deriveClientOrderId(identity(variant))).not.toBe(base);
    }
  });

  it("normalises symbol case so EURUSD and eurusd are one decision, not two", () => {
    expect(deriveClientOrderId(identity({ symbol: "eurusd" }))).toBe(deriveClientOrderId(identity()));
  });

  it("cannot be collided by shifting characters between fields", () => {
    const a = deriveClientOrderId(identity({ strategy: "AB", symbol: "C" }));
    const b = deriveClientOrderId(identity({ strategy: "A", symbol: "BC" }));
    expect(a).not.toBe(b);
  });

  it("treats an omitted sequence as 0", () => {
    expect(deriveClientOrderId(identity({ sequence: 0 }))).toBe(deriveClientOrderId(identity()));
  });

  it("fits inside broker id length limits", () => {
    expect(deriveClientOrderId(identity()).length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
  });

  it("honours a custom prefix and rejects an invalid one", () => {
    expect(deriveClientOrderId(identity(), "live")).toMatch(/^live-[0-9a-f]{16}$/);
    expect(() => deriveClientOrderId(identity(), "")).toThrow(/alphanumeric/);
    expect(() => deriveClientOrderId(identity(), "way-too-long")).toThrow(/alphanumeric/);
  });

  it("gives different ids under different prefixes", () => {
    expect(deriveClientOrderId(identity(), "ts")).not.toBe(deriveClientOrderId(identity(), "live"));
  });
});
