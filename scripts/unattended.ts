#!/usr/bin/env tsx
/**
 * Unattended paper-mode demonstration.
 *
 *   npm run unattended
 *
 * Runs the trading loop through a scripted gauntlet of the failures an
 * unattended system actually meets — a dropped market feed, an unreachable
 * broker, a rejected order, a partial fill, an order whose outcome is unknown,
 * and a process restart — and shows what it did at each step.
 *
 * Nothing here reaches a venue: the gateway is a programmable fake and declares
 * isLive: false, which runCycle enforces.
 */

import {
  createFakeGateway,
  createInMemoryOrderStore,
  type BrokerGateway,
  type OrderStore,
} from "../app/lib/domains/execution";
import { CONSERVATIVE_POLICY, type RiskPolicy } from "../app/lib/domains/riskcontrol";
import { DEFAULT_RISK_LIMITS } from "../app/lib/domains/simulator";
import {
  createInMemoryDecisionLog,
  createInMemoryEquityStore,
  createInMemoryKillSwitch,
  release,
  renderDashboard,
  runCycle,
  type DecisionLog,
  type EquityStore,
  type KillSwitchStore,
  type LoopContext,
  type MarketFeed,
} from "../app/lib/domains/trader";
import { alertsForCycle, createConsoleNotifier, diffAlerts, neverThrows } from "../app/lib/domains/trader";
import type { Strategy } from "../app/lib/domains/simulator";
import { holdSignal } from "../app/lib/domains/simulator";
import type { Bar, Signal } from "../app/lib/domains/simulator";

const SYMBOL = "TEST";
let clockTick = 0;
const now = () => new Date(Date.parse("2026-09-16T09:00:00.000Z") + clockTick * 60_000).toISOString();

/** Grows by one bar per cycle, so each cycle is a genuinely new decision and
 *  derives its own client order id rather than deduplicating against the last. */
let barCount = 60;
const makeBars = (): Bar[] =>
  Array.from({ length: barCount }, (_, i) => ({
    time: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 86_400_000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
  }));

const entry: Signal = {
  symbol: SYMBOL,
  action: "enter_long",
  confidence: 0.9,
  stopPrice: 90,
  targetPrice: 130,
  rationale: "demo entry signal",
  source: "rule",
};

const strategy: Strategy = { name: "demo", warmupBars: 10, decide: () => entry };

const policy: RiskPolicy = {
  ...CONSERVATIVE_POLICY,
  maxPositionUnits: 100,
  maxOrdersPerHour: 100,
  minSecondsBetweenOrders: 0,
};

const healthyFeed: MarketFeed = {
  bars: async () => makeBars(),
  quote: async () => ({ symbol: SYMBOL, bid: 99.99, ask: 100.01, at: now() }),
};

type Shared = { orders: OrderStore; log: DecisionLog; killSwitch: KillSwitchStore; equity: EquityStore };

function context(shared: Shared, gateway: BrokerGateway, feed: MarketFeed): LoopContext {
  return {
    symbol: SYMBOL,
    strategy,
    gateway,
    feed,
    orders: shared.orders,
    log: shared.log,
    killSwitch: shared.killSwitch,
    equity: shared.equity,
    policy,
    limits: DEFAULT_RISK_LIMITS,
    now,
  };
}

const step = (n: number, title: string) => {
  console.log(`\n${"─".repeat(78)}\n  STEP ${n}: ${title}\n${"─".repeat(78)}`);
};

async function main(): Promise<void> {
  const shared: Shared = {
    orders: createInMemoryOrderStore(),
    log: createInMemoryDecisionLog(),
    killSwitch: createInMemoryKillSwitch(),
    equity: createInMemoryEquityStore(),
  };

  // ONE gateway for the whole run. Faults are injected into it rather than
  // replacing it, because a replaced broker looks exactly like a broker that
  // lost every order — which the loop rightly refuses to trade through.
  const gateway = createFakeGateway({ clock: now });
  const outcomes: string[] = [];

  const cycle = async (label: string, feed: MarketFeed = healthyFeed) => {
    clockTick++;
    barCount++;
    const report = await runCycle(context(shared, gateway, feed));
    const refusal = report.decisions.find((d) => d.phase === "preflight" && !d.proceeded);
    const verdict = report.orderSubmitted
      ? `order placed (${report.clientOrderId})`
      : report.selfHalted
        ? `SELF-HALTED: ${report.selfHalted.slice(0, 60)}`
        : `no order — ${refusal ? refusal.summary : report.decisions[report.decisions.length - 1].summary}`;
    const open = await shared.orders.openOrders();
    console.log(`  ${verdict}`);

    // Alerting runs on TRANSITIONS. A halted system running a cycle a minute
    // would otherwise page 480 times before anyone woke up, and the 480th is
    // read by nobody — they mute the channel, and the mute outlives the
    // incident. Recovery is announced too, or the operator has to go and look.
    const { send, keys } = diffAlerts(alertsForCycle(report), alertKeys, report.at);
    alertKeys = keys;
    for (const alert of send) await notifier.send(alert);
    if (process.env.DEBUG_UNATTENDED) {
      console.log(`      [open orders: ${open.length} | halts: ${report.halts.map((h) => h.reason).join(",") || "none"}]`);
    }
    outcomes.push(`${label}: ${verdict}`);
    return report;
  };

  let alertKeys: string[] = [];
  const notifier = neverThrows(
    createConsoleNotifier((line) => console.log(`  >>> ALERT ${line}`)),
    (error) => console.log(`  >>> alerting failed, trading continues: ${String(error)}`),
  );

  step(1, "Normal operation");
  await cycle("normal");
  console.log(`  broker now holds ${gateway.orderCount()} order(s)`);

  step(2, "Market data feed goes down");
  await cycle("feed down", { bars: async () => { throw new Error("feed timeout"); }, quote: healthyFeed.quote });

  step(3, "Broker unreachable");
  gateway.queueGetPositionsFaults("disconnect");
  await cycle("broker unreachable");
  console.log("  recovers on the next cycle without intervention:");
  await cycle("recovered");

  step(4, "Broker rejects the order");
  gateway.queueSubmitFaults("reject");
  await cycle("rejected");
  console.log("  a rejection is a normal outcome, not a halt — the loop continues");

  /** Cancel outstanding orders and reconcile until the book is clean, so the
   *  next scenario starts from a known state. Uses a hold-only strategy, since
   *  a settling cycle that places new orders never settles. */
  const settle = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const open = await shared.orders.openOrders();
      if (open.length === 0) return;
      for (const o of open) await gateway.cancel(o.clientOrderId);
      clockTick++;
      await runCycle({
        ...context(shared, gateway, healthyFeed),
        strategy: { name: "hold", warmupBars: 10, decide: (c) => holdSignal(c.symbol, "settling") },
      });
    }
  };

  step(5, "Broker cannot answer about existing orders");
  // Reconciliation queries every non-terminal order by client id. If those
  // queries fail, the system cannot establish what it holds, and it says so
  // rather than trading around the uncertainty.
  gateway.queueGetOrderFaults("disconnect", "disconnect", "disconnect");
  await cycle("order query down");
  console.log("  it will not trade while it cannot establish what it holds");

  await settle();
  console.log(`  book settled: ${(await shared.orders.openOrders()).length} open orders`);

  step(6, "Order sent, outcome unknown — the dangerous one");
  gateway.queueSubmitFaults("timeout_but_lands");
  gateway.queueGetOrderFaults("disconnect", "disconnect", "disconnect", "disconnect", "disconnect");
  await cycle("ambiguous send");
  console.log(`  kill switch now: ${(await shared.killSwitch.read()).engaged ? "ENGAGED" : "released"}`);
  console.log("  the order may or may not be live, so the system stops itself rather than guessing");

  step(7, "Still halted — no new risk taken");
  await cycle("while halted");

  step(8, "Operator releases the kill switch");
  clockTick++;
  await release(shared.killSwitch, "operator", now());
  await cycle("after release");

  step(9, "Partial fill");
  const partial = await cycle("partial fill");
  if (partial.clientOrderId) {
    gateway.fill(partial.clientOrderId, 4, 100.02);
    gateway.setPositions([{ symbol: SYMBOL, quantity: 4, averagePrice: 100.02 }]);
    console.log("  broker reports 4 of 10 filled; next cycle reconciles against it:");
    await cycle("after partial fill");
    console.log("  it declines to add to a position it already holds");
  }

  step(10, "Process restart — same stores, fresh loop");
  console.log("  re-running the SAME decision after a restart:");
  barCount--; // same decision bar as the previous cycle -> same client order id
  clockTick++;
  const before = gateway.submitCalls();
  await runCycle(context(shared, gateway, healthyFeed));
  console.log(`  submit calls before restart: ${before}, after: ${gateway.submitCalls()}`);
  console.log(
    gateway.submitCalls() === before
      ? "  no duplicate order was sent"
      : "  WARNING: a duplicate order was sent",
  );

  console.log(`\n${"═".repeat(78)}\n  DASHBOARD\n`);
  const account = await gateway.getAccount();
  console.log(
    renderDashboard({
      at: now(),
      symbol: SYMBOL,
      killSwitch: await shared.killSwitch.read(),
      halts: [],
      positions: await gateway.getPositions(),
      openOrders: await shared.orders.openOrders(),
      recentDecisions: await shared.log.recent(12),
      equity: await shared.equity.read(),
      accountEquity: account.equity,
    }),
  );

  console.log(`\n  ${(await shared.log.all()).length} decisions recorded across ${outcomes.length} cycles.`);
  console.log("  Paper mode throughout — the gateway is a fake and declares isLive: false.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
