import { describe, expect, it } from "vitest";
import { renderDashboard, type DashboardModel } from "./dashboard";
import { RELEASED } from "./kill-switch";

const model = (overrides: Partial<DashboardModel> = {}): DashboardModel => ({
  at: "2026-09-16T12:00:00.000Z",
  symbol: "TEST",
  killSwitch: RELEASED,
  halts: [],
  positions: [],
  openOrders: [],
  recentDecisions: [],
  equity: null,
  accountEquity: null,
  ...overrides,
});

describe("renderDashboard", () => {
  it("reports running when nothing is wrong", () => {
    expect(renderDashboard(model())).toContain("RUNNING — no active halts");
  });

  it("leads with the kill switch when it is engaged", () => {
    const out = renderDashboard(
      model({ killSwitch: { engaged: true, reason: "operator pulled it", at: "x", by: "operator" } }),
    );
    expect(out).toContain("HALTED — kill switch: operator pulled it");
  });

  it("names every reason it is standing down", () => {
    const out = renderDashboard(
      model({ halts: [{ reason: "connectivity", detail: "feed down" }, { reason: "stale_data", detail: "quote 10m old" }] }),
    );
    expect(out).toContain("STANDING DOWN");
    expect(out).toContain("connectivity: feed down");
    expect(out).toContain("stale_data: quote 10m old");
  });

  it("says flat rather than showing an empty table", () => {
    expect(renderDashboard(model())).toContain("flat");
  });

  it("shows direction from the sign of the quantity", () => {
    const out = renderDashboard(model({ positions: [{ symbol: "TEST", quantity: -4, averagePrice: 99 }] }));
    expect(out).toContain("short");
    expect(out).toContain("4 @ 99");
  });

  it("renders a zero quantity as flat rather than long", () => {
    const out = renderDashboard(model({ positions: [{ symbol: "TEST", quantity: 0, averagePrice: 99 }] }));
    expect(out).toContain("flat");
    expect(out).not.toContain("long");
  });

  it("returns nothing for a zero-length decision request", () => {
    // slice(-0) is slice(0) and would return the whole log.
    expect(renderDashboard(model())).toContain("none recorded");
  });

  it("computes drawdown against the remembered peak, not current equity", () => {
    const out = renderDashboard(
      model({ accountEquity: 8_000, equity: { day: "2026-09-16", dayStartEquity: 9_000, peakEquity: 10_000 } }),
    );
    expect(out).toContain("drawdown 20.00%");
  });

  it("shows the reason for each decision, not just the outcome", () => {
    const out = renderDashboard(
      model({
        recentDecisions: [
          {
            seq: 1,
            at: "2026-09-16T12:00:00.000Z",
            cycleId: "c1",
            phase: "preflight",
            symbol: "TEST",
            proceeded: false,
            summary: "refused: spread_too_wide",
            inputs: {},
            outputs: {},
            ai: null,
          },
        ],
      }),
    );
    expect(out).toContain("refused: spread_too_wide");
    expect(out).toContain("✕");
  });

  const workingOrder = (overrides: Record<string, unknown> = {}) => ({
    clientOrderId: "ts-1", symbol: "TEST", side: "buy" as const, quantity: 10, intent: "open" as const,
    stopPrice: null, takeProfitPrice: null, reason: "r", status: "submitted" as const,
    brokerOrderId: "B1", filledQuantity: 0, averageFillPrice: null, rejectReason: null,
    createdAt: "x", updatedAt: "x", submitAttempts: 1,
    ...overrides,
  });

  it("shows working exposure under POSITIONS, not just under OPEN ORDERS", () => {
    // Otherwise the screen reads as a contradiction: "flat" next to a decision
    // log saying "already in position", which is how an operator talks
    // themselves into intervening at three in the morning.
    const out = renderDashboard(model({ positions: [], openOrders: [workingOrder()] }));
    expect(out).toContain("WORKING");
    expect(out).toContain("counts against limits");
    expect(out).not.toContain("flat");
  });

  it("shows only the unfilled residual as working", () => {
    const out = renderDashboard(
      model({ positions: [], openOrders: [workingOrder({ quantity: 10, filledQuantity: 4, status: "partially_filled" })] }),
    );
    expect(out).toMatch(/long\s+6 WORKING/);
  });

  it("calls a working sell short", () => {
    const out = renderDashboard(
      model({ positions: [], openOrders: [workingOrder({ side: "sell", intent: "close" })] }),
    );
    expect(out).toMatch(/short\s+10 WORKING/);
  });

  it("still reads flat when an open order has nothing left to fill", () => {
    const out = renderDashboard(
      model({ positions: [], openOrders: [workingOrder({ quantity: 10, filledQuantity: 10 })] }),
    );
    expect(out).toContain("flat");
    expect(out).not.toContain("WORKING");
  });

  it("surfaces partial fills on open orders", () => {
    const out = renderDashboard(
      model({
        openOrders: [
          {
            clientOrderId: "ts-1", symbol: "TEST", side: "buy", quantity: 10, intent: "open",
            stopPrice: null, takeProfitPrice: null, reason: "r", status: "partially_filled",
            brokerOrderId: "B1", filledQuantity: 4, averageFillPrice: 100, rejectReason: null,
            createdAt: "x", updatedAt: "x", submitAttempts: 1,
          },
        ],
      }),
    );
    expect(out).toContain("partially_filled");
    expect(out).toContain("(filled 4)");
  });
});
