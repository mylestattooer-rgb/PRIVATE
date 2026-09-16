import { describe, expect, it } from "vitest";
import {
  assessSignal,
  DEFAULT_RISK_LIMITS,
  evaluateKillSwitch,
  openTradingDay,
  sizePosition,
  type RiskContext,
} from "./risk";
import type { Position, Signal } from "./types";

const signal = (overrides: Partial<Signal> = {}): Signal => ({
  symbol: "AAPL",
  action: "enter_long",
  confidence: 0.8,
  stopPrice: 90,
  targetPrice: 120,
  rationale: "test",
  source: "rule",
  ...overrides,
});

const position = (overrides: Partial<Position> = {}): Position => ({
  symbol: "AAPL",
  side: "long",
  quantity: 10,
  avgEntryPrice: 100,
  stopPrice: 90,
  targetPrice: 120,
  openedAt: "2026-01-01T00:00:00.000Z",
  riskPerUnit: 10,
  ...overrides,
});

const context = (overrides: Partial<RiskContext> = {}): RiskContext => ({
  equity: 10_000,
  cash: 10_000,
  referencePrice: 100,
  positions: [],
  killSwitch: openTradingDay("2026-01-01", 10_000),
  limits: DEFAULT_RISK_LIMITS,
  orderId: "o-1",
  ...overrides,
});

describe("sizePosition", () => {
  it("sizes from the risk budget when risk is the binding constraint", () => {
    // 1% of 10,000 = 100 risk budget; 10 of risk per unit → 10 units.
    const { quantity, riskPerUnit } = sizePosition(100, 90, 10_000, 10_000, DEFAULT_RISK_LIMITS);
    expect(riskPerUnit).toBe(10);
    expect(quantity).toBe(10);
  });

  it("clamps to the notional cap when the stop is tight", () => {
    // A 2-wide stop would allow 50 units by risk, but 20% of 10,000 at 100
    // caps the position at 20.
    expect(sizePosition(100, 98, 10_000, 10_000, DEFAULT_RISK_LIMITS).quantity).toBe(20);
  });

  it("clamps to available cash", () => {
    expect(sizePosition(100, 90, 10_000, 500, DEFAULT_RISK_LIMITS).quantity).toBe(5);
  });

  it("returns zero when the stop equals the reference price", () => {
    expect(sizePosition(100, 100, 10_000, 10_000, DEFAULT_RISK_LIMITS).quantity).toBe(0);
  });

  it("floors to whole units rather than rounding up", () => {
    // 1% of 10,000 = 100 budget, 30 per unit → 3.33 units.
    expect(sizePosition(100, 70, 10_000, 10_000, DEFAULT_RISK_LIMITS).quantity).toBe(3);
  });
});

describe("evaluateKillSwitch", () => {
  const limits = { ...DEFAULT_RISK_LIMITS, maxDailyLossPct: 3 };

  it("stays untripped above the loss limit", () => {
    const state = evaluateKillSwitch(openTradingDay("2026-01-01", 10_000), 9_800, limits);
    expect(state.tripped).toBe(false);
  });

  it("trips exactly at the limit", () => {
    const state = evaluateKillSwitch(openTradingDay("2026-01-01", 10_000), 9_700, limits);
    expect(state.tripped).toBe(true);
    expect(state.reason).toContain("3% limit");
  });

  it("latches — a recovery does not un-trip the day", () => {
    const tripped = evaluateKillSwitch(openTradingDay("2026-01-01", 10_000), 9_000, limits);
    const recovered = evaluateKillSwitch(tripped, 10_500, limits);
    expect(recovered.tripped).toBe(true);
    expect(recovered).toBe(tripped);
  });

  it("resets on a new trading day", () => {
    const tripped = evaluateKillSwitch(openTradingDay("2026-01-01", 10_000), 9_000, limits);
    expect(openTradingDay("2026-01-02", tripped.dayStartEquity).tripped).toBe(false);
  });
});

describe("assessSignal", () => {
  it("approves a sized entry order and records the risk taken", () => {
    const decision = assessSignal(signal(), context());
    expect(decision.approved).toBe(true);
    if (!decision.approved) return;
    expect(decision.order.quantity).toBe(10);
    expect(decision.order.side).toBe("buy");
    expect(decision.order.intent).toBe("open");
    // 10 units × 10 of risk = 100 = the configured 1% of equity.
    expect(decision.order.riskAmount).toBe(100);
  });

  it("uses the caller-supplied order id, never a generated one", () => {
    const decision = assessSignal(signal(), context({ orderId: "deterministic-7" }));
    expect(decision.approved && decision.order.id).toBe("deterministic-7");
  });

  it("rejects a hold without producing an order", () => {
    const decision = assessSignal(signal({ action: "hold" }), context());
    expect(decision).toMatchObject({ approved: false, reason: "hold" });
  });

  it("rejects confidence below the floor", () => {
    const decision = assessSignal(signal({ confidence: 0.2 }), context());
    expect(decision).toMatchObject({ approved: false, reason: "confidence_below_floor" });
  });

  it("rejects a long stop above the reference price", () => {
    const decision = assessSignal(signal({ stopPrice: 110 }), context());
    expect(decision).toMatchObject({ approved: false, reason: "stop_on_wrong_side" });
  });

  it("rejects a short stop below the reference price", () => {
    const decision = assessSignal(signal({ action: "enter_short", stopPrice: 90 }), context());
    expect(decision).toMatchObject({ approved: false, reason: "stop_on_wrong_side" });
  });

  it("approves a short with a stop above the reference price", () => {
    const decision = assessSignal(signal({ action: "enter_short", stopPrice: 110 }), context());
    expect(decision.approved).toBe(true);
    if (!decision.approved) return;
    expect(decision.order.side).toBe("sell");
    expect(decision.order.positionSide).toBe("short");
  });

  it("refuses to add to an existing position", () => {
    const decision = assessSignal(signal(), context({ positions: [position()] }));
    expect(decision).toMatchObject({ approved: false, reason: "already_in_position" });
  });

  it("refuses a new symbol once the open-position limit is reached", () => {
    const positions = [
      position({ symbol: "A" }),
      position({ symbol: "B" }),
      position({ symbol: "C" }),
    ];
    const decision = assessSignal(signal({ symbol: "AAPL" }), context({ positions }));
    expect(decision).toMatchObject({ approved: false, reason: "position_limit_reached" });
  });

  it("rejects when the risk budget cannot afford a single unit", () => {
    const decision = assessSignal(
      signal({ stopPrice: 40 }),
      context({ equity: 1_000, cash: 1_000, referencePrice: 100 }),
    );
    expect(decision).toMatchObject({ approved: false, reason: "size_rounds_to_zero" });
  });

  it("reports insufficient cash separately from an unaffordable risk budget", () => {
    const decision = assessSignal(signal(), context({ cash: 50 }));
    expect(decision).toMatchObject({ approved: false, reason: "insufficient_cash" });
  });

  describe("with the kill switch tripped", () => {
    const halted = context({
      killSwitch: {
        day: "2026-01-01",
        dayStartEquity: 10_000,
        tripped: true,
        reason: "daily loss 4.00% reached the 3% limit",
      },
    });

    it("blocks new entries", () => {
      const decision = assessSignal(signal(), halted);
      expect(decision).toMatchObject({ approved: false, reason: "kill_switch_tripped" });
    });

    it("still lets an open position be closed — a halt must never trap a trade", () => {
      const decision = assessSignal(
        signal({ action: "exit", confidence: 0 }),
        { ...halted, positions: [position()] },
      );
      expect(decision.approved).toBe(true);
      if (!decision.approved) return;
      expect(decision.order.intent).toBe("close");
      expect(decision.order.side).toBe("sell");
      expect(decision.order.quantity).toBe(10);
    });
  });

  it("closes a short by buying back the full quantity", () => {
    const decision = assessSignal(
      signal({ action: "exit" }),
      context({ positions: [position({ side: "short" })] }),
    );
    expect(decision.approved).toBe(true);
    if (!decision.approved) return;
    expect(decision.order.side).toBe("buy");
  });

  it("rejects an exit with nothing open", () => {
    const decision = assessSignal(signal({ action: "exit" }), context());
    expect(decision).toMatchObject({ approved: false, reason: "no_position_to_close" });
  });
});
