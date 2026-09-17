import { describe, expect, it } from "vitest";
import { createFakeGateway } from "../execution/fake-gateway";
import { createInMemoryOrderStore } from "../execution/order-store";
import { deriveWorkingQuantities, reconcile } from "../execution/reconcile";
import { isTerminal } from "../execution/types";
import { LiveGatewayRefusedError, type BrokerGateway } from "../execution/gateway";
import { holdSignal } from "../simulator/signal";
import { DEFAULT_RISK_LIMITS } from "../simulator/risk";
import { CONSERVATIVE_POLICY, type RiskPolicy } from "../riskcontrol";
import { createInMemoryDecisionLog } from "./decision-log";
import { createInMemoryKillSwitch, engage } from "./kill-switch";
import { createInMemoryEquityStore, runCycle, type LoopContext, type MarketFeed } from "./loop";
import type { Strategy } from "../simulator/backtest";
import type { Bar, Signal } from "../simulator/types";

const NOW = "2026-09-16T12:00:00.000Z";
const now = () => NOW;

const bars = (count = 60): Bar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 86_400_000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
  }));

const feed = (overrides: Partial<MarketFeed> = {}): MarketFeed => ({
  bars: async () => bars(),
  quote: async () => ({ symbol: "TEST", bid: 99.99, ask: 100.01, at: "2026-09-16T11:59:50.000Z" }),
  ...overrides,
});

const enterLong: Signal = {
  symbol: "TEST",
  action: "enter_long",
  confidence: 0.9,
  stopPrice: 90,
  targetPrice: 130,
  rationale: "scripted entry",
  source: "rule",
};

const strategy = (signal: Signal | null = enterLong): Strategy => ({
  name: "scripted",
  warmupBars: 10,
  decide: (c) => signal ?? holdSignal(c.symbol, "nothing to do"),
});

/** Permissive where the test is not the point, strict where it is. */
const policy = (overrides: Partial<RiskPolicy> = {}): RiskPolicy => ({
  ...CONSERVATIVE_POLICY,
  maxPositionUnits: 100,
  maxOrdersPerHour: 100,
  minSecondsBetweenOrders: 0,
  ...overrides,
});

const context = (overrides: Partial<LoopContext> = {}): LoopContext => ({
  symbol: "TEST",
  strategy: strategy(),
  gateway: createFakeGateway(),
  feed: feed(),
  orders: createInMemoryOrderStore(),
  log: createInMemoryDecisionLog(),
  killSwitch: createInMemoryKillSwitch(),
  equity: createInMemoryEquityStore(),
  policy: policy(),
  limits: DEFAULT_RISK_LIMITS,
  now,
  ...overrides,
});

describe("a clean cycle", () => {
  it("reconciles, decides, gates, and submits one order", async () => {
    const gateway = createFakeGateway();
    const report = await runCycle(context({ gateway }));

    expect(report.orderSubmitted).toBe(true);
    expect(gateway.orderCount()).toBe(1);
    // 1% of 10,000 equity over a 10-wide stop = 10 units.
    expect(gateway.orders()[0].status).toBe("submitted");
  });

  it("logs every phase, with the inputs a decision was made from", async () => {
    const log = createInMemoryDecisionLog();
    await runCycle(context({ log }));

    const phases = (await log.all()).map((r) => r.phase);
    expect(phases).toEqual([
      "cycle_start",
      "kill_switch",
      "reconcile",
      "market_data",
      "signal",
      "preflight",
      "submit",
      "cycle_end",
    ]);

    const signalRecord = (await log.all()).find((r) => r.phase === "signal")!;
    expect(signalRecord.inputs).toHaveProperty("decisionBar");
    expect(signalRecord.inputs).toHaveProperty("equity", 10_000);
    expect(signalRecord.outputs).toMatchObject({ action: "enter_long", stopPrice: 90 });
  });

  it("records the risk gate's full check list, not just the outcome", async () => {
    const log = createInMemoryDecisionLog();
    await runCycle(context({ log }));
    const preflightRecord = (await log.all()).find((r) => r.phase === "preflight")!;
    expect(Array.isArray(preflightRecord.outputs.checks)).toBe(true);
    expect((preflightRecord.outputs.checks as unknown[]).length).toBeGreaterThan(10);
  });
});

describe("the kill switch", () => {
  it("stops new entries", async () => {
    const killSwitch = createInMemoryKillSwitch();
    await engage(killSwitch, "operator pulled it", "operator", NOW);
    const gateway = createFakeGateway();

    const report = await runCycle(context({ gateway, killSwitch }));

    expect(report.orderSubmitted).toBe(false);
    expect(gateway.orderCount()).toBe(0);
    expect(report.halts.some((h) => h.reason === "manual_kill_switch")).toBe(true);
  });

  it("still lets an open position be closed", async () => {
    const killSwitch = createInMemoryKillSwitch();
    await engage(killSwitch, "get me out", "operator", NOW);
    const gateway = createFakeGateway({ positions: [{ symbol: "TEST", quantity: 10, averagePrice: 100 }] });
    const exit: Signal = { ...enterLong, action: "exit", stopPrice: null, targetPrice: null };

    const report = await runCycle(context({ gateway, killSwitch, strategy: strategy(exit) }));

    // Halted, and the exit went through anyway — which is the point of halting.
    expect(report.halts.some((h) => h.reason === "manual_kill_switch")).toBe(true);
    expect(report.orderSubmitted).toBe(true);
    expect(gateway.orders()[0].clientOrderId).toBe(report.clientOrderId);
  });
});

describe("failure handling", () => {
  it("does not trade when reconciliation finds a position it cannot explain", async () => {
    const gateway = createFakeGateway({ positions: [{ symbol: "OTHER", quantity: 5, averagePrice: 50 }] });
    const report = await runCycle(context({ gateway }));

    expect(report.orderSubmitted).toBe(false);
    expect(report.halts.some((h) => h.reason === "reconciliation_discrepancy")).toBe(true);
  });

  it("does not trade when the broker cannot be reached for positions", async () => {
    const gateway = createFakeGateway({ getPositionsFaults: ["disconnect"] });
    const report = await runCycle(context({ gateway }));

    expect(report.orderSubmitted).toBe(false);
    expect(report.halts.some((h) => h.reason === "connectivity")).toBe(true);
  });

  it("does not trade when the account cannot be read", async () => {
    const base = createFakeGateway();
    const gateway: BrokerGateway = { ...base, getAccount: async () => { throw new Error("socket closed"); } };
    const report = await runCycle(context({ gateway }));

    expect(report.orderSubmitted).toBe(false);
    expect(report.halts.some((h) => h.reason === "connectivity")).toBe(true);
  });

  it("does not trade when market data is unavailable", async () => {
    const report = await runCycle(
      context({ feed: feed({ bars: async () => { throw new Error("feed down"); } }) }),
    );
    expect(report.orderSubmitted).toBe(false);
    expect(report.halts.some((h) => h.reason === "connectivity")).toBe(true);
  });

  it("waits rather than trading on insufficient history", async () => {
    const report = await runCycle(context({ feed: feed({ bars: async () => bars(5) }) }));
    expect(report.orderSubmitted).toBe(false);
  });

  it("records a rejection without halting the system", async () => {
    const gateway = createFakeGateway({ submitFaults: ["reject"] });
    const report = await runCycle(context({ gateway }));

    expect(report.orderSubmitted).toBe(false);
    expect(report.selfHalted).toBeNull();
    const submit = report.decisions.find((d) => d.phase === "submit")!;
    expect(submit.outputs).toMatchObject({ outcome: "rejected", status: "rejected" });
  });

  it("halts itself when an order's outcome cannot be determined", async () => {
    const killSwitch = createInMemoryKillSwitch();
    const gateway = createFakeGateway({
      submitFaults: ["timeout_but_lands"],
      getOrderFaults: ["disconnect", "disconnect", "disconnect", "disconnect", "disconnect"],
    });

    const report = await runCycle(context({ gateway, killSwitch }));

    expect(report.selfHalted).not.toBeNull();
    // And it persisted, so the next cycle and any restart both see it.
    expect((await killSwitch.read()).engaged).toBe(true);
    expect((await killSwitch.read()).by).toBe("loop:unresolved_order");
  });
});

describe("risk gate", () => {
  it("refuses an order that breaches a limit and says which", async () => {
    const gateway = createFakeGateway();
    const report = await runCycle(context({ gateway, policy: policy({ maxPositionUnits: 1 }) }));

    expect(report.orderSubmitted).toBe(false);
    expect(gateway.orderCount()).toBe(0);
    const preflightRecord = report.decisions.find((d) => d.phase === "preflight")!;
    expect(preflightRecord.summary).toContain("position_units_exceeded");
  });

  it("refuses on a stale quote even when everything else is fine", async () => {
    const stale = feed({
      quote: async () => ({ symbol: "TEST", bid: 99.99, ask: 100.01, at: "2026-09-16T10:00:00.000Z" }),
    });
    const report = await runCycle(context({ feed: stale }));
    expect(report.orderSubmitted).toBe(false);
  });

  it("refuses on a wide spread", async () => {
    const wide = feed({
      quote: async () => ({ symbol: "TEST", bid: 95, ask: 105, at: "2026-09-16T11:59:50.000Z" }),
    });
    expect((await runCycle(context({ feed: wide }))).orderSubmitted).toBe(false);
  });
});

describe("restart recovery", () => {
  it("does not duplicate an order when the same cycle runs again", async () => {
    const gateway = createFakeGateway();
    const orders = createInMemoryOrderStore();
    const shared = { gateway, orders };

    await runCycle(context(shared));
    // Same decision bar, so the same client order id is derived. A restarted
    // process must recognise the order rather than place a second one.
    await runCycle(context(shared));

    expect(gateway.submitCalls()).toBe(1);
    expect(gateway.orderCount()).toBe(1);
  });

  it("remembers peak equity across cycles, so drawdown is measured from a real peak", async () => {
    const equity = createInMemoryEquityStore();
    const rich = createFakeGateway({ account: { equity: 20_000, balance: 20_000 } });
    await runCycle(context({ gateway: rich, equity }));
    expect((await equity.read())!.peakEquity).toBe(20_000);

    // Equity halves. The peak must not follow it down.
    const poor = createFakeGateway({ account: { equity: 10_000, balance: 10_000 } });
    await runCycle(context({ gateway: poor, equity }));
    expect((await equity.read())!.peakEquity).toBe(20_000);
  });

  it("blocks entries once drawdown from the remembered peak breaches the limit", async () => {
    const equity = createInMemoryEquityStore({ day: "2026-09-16", dayStartEquity: 10_000, peakEquity: 20_000 });
    const gateway = createFakeGateway({ account: { equity: 10_000, balance: 10_000 } });

    const report = await runCycle(context({ gateway, equity, policy: policy({ maxDrawdownPct: 10 }) }));

    expect(report.orderSubmitted).toBe(false);
    expect(report.decisions.find((d) => d.phase === "preflight")!.summary).toContain("drawdown_limit");
  });
});

describe("regressions from adversarial review", () => {
  it("treats a zero-quantity broker position as flat, not a phantom long", async () => {
    // 0 is the documented representation of flat. Read as a position it either
    // freezes the account out of entries or emits a 0-quantity close order.
    const gateway = createFakeGateway({ positions: [{ symbol: "TEST", quantity: 0, averagePrice: 100 }] });
    const orders = createInMemoryOrderStore();
    const report = await runCycle(context({ gateway, orders }));

    expect(report.orderSubmitted).toBe(true);
    const stored = await orders.get(report.clientOrderId!);
    // An entry, not a phantom zero-quantity close.
    expect(stored!.intent).toBe("open");
    expect(stored!.quantity).toBeGreaterThan(0);
  });

  it("actually enforces the layer-1 daily loss limit", async () => {
    // Previously the loop rebuilt an untripped kill switch every cycle, so
    // maxDailyLossPct never bound and assessSignal's branch for it was dead.
    const equity = createInMemoryEquityStore({
      day: "2026-09-16",
      dayStartEquity: 10_000,
      peakEquity: 10_000,
    });
    const gateway = createFakeGateway({ account: { equity: 9_000, balance: 9_000 } });

    const report = await runCycle(
      context({ gateway, equity, limits: { ...DEFAULT_RISK_LIMITS, maxDailyLossPct: 3 } }),
    );

    expect(report.orderSubmitted).toBe(false);
    expect(report.halts.some((h) => h.reason === "risk_limit")).toBe(true);
  });

  it("halts instead of escaping when the adapter throws mid-submit", async () => {
    // A throw carries the same uncertainty as a timeout: the order may be live.
    const base = createFakeGateway();
    const gateway: BrokerGateway = {
      ...base,
      submit: async () => {
        throw new Error("socket reset mid-write");
      },
    };
    const killSwitch = createInMemoryKillSwitch();

    const report = await runCycle(context({ gateway, killSwitch }));

    expect(report.selfHalted).toContain("submit threw");
    expect((await killSwitch.read()).engaged).toBe(true);
    // The cycle still closed its own record rather than unwinding.
    expect(report.decisions[report.decisions.length - 1].phase).toBe("cycle_end");
  });

  it("passes every open position to layer 1, so its position limit can fire", async () => {
    const gateway = createFakeGateway({
      positions: [
        { symbol: "OTHER1", quantity: 1, averagePrice: 10 },
        { symbol: "OTHER2", quantity: 1, averagePrice: 10 },
        { symbol: "OTHER3", quantity: 1, averagePrice: 10 },
      ],
    });
    const report = await runCycle(
      context({ gateway, limits: { ...DEFAULT_RISK_LIMITS, maxOpenPositions: 3 } }),
    );

    expect(report.orderSubmitted).toBe(false);
    // Reconciliation halts on the unknown positions too; what matters is that
    // layer 1 saw them rather than an empty list.
    const sizing = report.decisions.find((d) => d.phase === "preflight");
    expect(sizing).toBeDefined();
  });
});

describe("live guard", () => {
  it("refuses a live gateway unless explicitly allowed", async () => {
    const live = createFakeGateway({ isLive: true });
    await expect(runCycle(context({ gateway: live }))).rejects.toThrow(LiveGatewayRefusedError);
    expect(live.submitCalls()).toBe(0);
  });

  it("proceeds against a live gateway only when the operator opts in", async () => {
    const live = createFakeGateway({ isLive: true });
    const report = await runCycle(context({ gateway: live, allowLive: true }));
    expect(report.orderSubmitted).toBe(true);
  });
});

describe("strategy inaction", () => {
  it("records a hold and places nothing", async () => {
    const gateway = createFakeGateway();
    const report = await runCycle(context({ gateway, strategy: strategy(null) }));

    expect(report.orderSubmitted).toBe(false);
    expect(gateway.orderCount()).toBe(0);
    expect(report.decisions.find((d) => d.phase === "signal")!.summary).toContain("hold");
  });
});

describe("orders still working at the broker count toward exposure", () => {
  /**
   * The failure this guards against, measured before the fix:
   *
   *   cycle 1  submit buy 10, broker acknowledges, nothing fills yet
   *   cycle 2  a new bar arrives -> new decision -> NEW client order id
   *            "all 14 risk checks passed"  -> submit buy 10 again
   *   cycle 3  same again
   *   result   3 orders, 30 units working, against a 10-unit intent
   *
   * The client-order-id guard cannot catch this. It stops the same decision
   * being sent twice, and each new bar is a genuinely different decision. Both
   * risk layers sized against FILLED positions, so a broker that had not filled
   * yet looked exactly like a broker holding nothing.
   */
  const growingFeed = (barCount: () => number, clock: () => string): MarketFeed => ({
    bars: async () => bars(barCount()),
    quote: async () => ({ symbol: "TEST", bid: 99.99, ask: 100.01, at: clock() }),
  });

  it("does not re-enter while an unfilled order is live", async () => {
    const gateway = createFakeGateway();
    const orders = createInMemoryOrderStore();
    let count = 60;
    let nowIso = "2026-09-16T12:00:00.000Z";
    const clock = () => nowIso;
    const ctx = () =>
      context({ gateway, orders, feed: growingFeed(() => count, clock), now: clock });

    const first = await runCycle(ctx());
    expect(first.orderSubmitted).toBe(true);

    // A new bar, so a genuinely new decision and a different client order id.
    count = 61;
    nowIso = "2026-09-16T13:00:00.000Z";
    const second = await runCycle(ctx());
    expect(second.clientOrderId).not.toBe(first.clientOrderId);
    expect(second.orderSubmitted).toBe(false);

    count = 62;
    nowIso = "2026-09-16T14:00:00.000Z";
    const third = await runCycle(ctx());
    expect(third.orderSubmitted).toBe(false);

    const book = await orders.all();
    const working = book
      .filter((o) => !isTerminal(o.status))
      .reduce((sum, o) => sum + (o.quantity - o.filledQuantity), 0);
    expect(book).toHaveLength(1);
    expect(working).toBe(first.clientOrderId ? (await orders.get(first.clientOrderId))!.quantity : 0);
  });

  it("still counts the residual after a partial fill", async () => {
    const gateway = createFakeGateway();
    const orders = createInMemoryOrderStore();
    let count = 60;
    let nowIso = "2026-09-16T12:00:00.000Z";
    const clock = () => nowIso;
    const ctx = () =>
      context({ gateway, orders, feed: growingFeed(() => count, clock), now: clock });

    const first = await runCycle(ctx());
    const placed = (await orders.get(first.clientOrderId!))!;

    // Half fills; the rest is still working.
    const half = placed.quantity / 2;
    gateway.fill(first.clientOrderId!, half, 100);
    gateway.setPositions([{ symbol: "TEST", quantity: half, averagePrice: 100 }]);

    count = 61;
    nowIso = "2026-09-16T13:00:00.000Z";
    const second = await runCycle(ctx());

    // Filled half + working half = the full intent. Nothing more may be added.
    expect(second.orderSubmitted).toBe(false);
    expect(await orders.all()).toHaveLength(1);
  });

  it("reports working quantity on the reconciliation report", async () => {
    const gateway = createFakeGateway();
    const orders = createInMemoryOrderStore();
    const clock = () => "2026-09-16T12:00:00.000Z";
    const first = await runCycle(
      context({ gateway, orders, feed: growingFeed(() => 60, clock), now: clock }),
    );
    const placed = (await orders.get(first.clientOrderId!))!;

    const report = await reconcile({ gateway, store: orders, now: clock });
    expect(report.workingQuantities).toEqual([{ symbol: "TEST", quantity: placed.quantity }]);
  });

  it("never blocks an exit — a working close moves exposure toward flat", async () => {
    // A halt that can trap you in a losing position is worse than no halt, and
    // the same must be true of an exposure guard. A working SELL is signed
    // negative against a long, so it can only reduce the number.
    const records = [
      {
        clientOrderId: "close-1",
        symbol: "TEST",
        side: "sell" as const,
        quantity: 10,
        intent: "close" as const,
        stopPrice: null,
        takeProfitPrice: null,
        reason: "exit",
        status: "submitted" as const,
        brokerOrderId: "B1",
        filledQuantity: 0,
        averageFillPrice: null,
        rejectReason: null,
        createdAt: "2026-09-16T12:00:00.000Z",
        updatedAt: "2026-09-16T12:00:00.000Z",
        submitAttempts: 1,
      },
    ];
    expect(deriveWorkingQuantities(records)).toEqual([{ symbol: "TEST", quantity: -10 }]);
  });
});
