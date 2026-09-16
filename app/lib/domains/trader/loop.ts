// The unattended trading cycle.
//
// One pass: read the kill switch, reconcile against the broker, fetch market
// data, ask the strategy, size the result, put it through the independent risk
// gate, and submit at most one order. Every phase writes to the decision log
// whether or not it proceeded, so the record explains a quiet night as clearly
// as a busy one.
//
// **Two independent risk layers, on purpose.** The simulator's Risk Manager
// sizes the position and applies its own limits; the risk-control preflight then
// evaluates the sized order against limits it owns exclusively. They share no
// code and no configuration. A bug or a bad parameter in one does not disarm the
// other, which is the entire value of calling them independent.
//
// **Halts gate entries, never exits.** Halts are collected and handed to
// preflight, which permits closing orders unconditionally. That means a halted
// system can still get out, which is almost always what the operator wanted when
// they halted it.

import {
  assessSignal,
  DEFAULT_RISK_LIMITS,
  evaluateKillSwitch,
  openTradingDay,
  type RiskLimits,
} from "../simulator/risk";
import { preflight, type ActiveHalt, type ProposedOrder, type Quote, type RiskPolicy } from "../riskcontrol";
import { deriveClientOrderId } from "../execution/client-order-id";
import { reconcile } from "../execution/reconcile";
import { submitOrder } from "../execution/submit";
import { LiveGatewayRefusedError, type BrokerGateway } from "../execution/gateway";
import type { OrderStore } from "../execution/order-store";
import type { Strategy } from "../simulator/backtest";
import type { Bar, Position, Signal } from "../simulator/types";
import { engage, type KillSwitchStore } from "./kill-switch";
import type { DecisionLog, DecisionRecord } from "./decision-log";

export type MarketFeed = {
  /** History up to and including the most recent closed bar. */
  bars(symbol: string): Promise<Bar[]>;
  quote(symbol: string): Promise<Quote | null>;
};

/** Survives restarts so the drawdown limit is measured from a real peak rather
 *  than from whatever equity happened to be when the process last started. */
export type EquityMemory = { day: string; dayStartEquity: number; peakEquity: number };

export type EquityStore = {
  read(): Promise<EquityMemory | null>;
  write(memory: EquityMemory): Promise<void>;
};

export function createInMemoryEquityStore(initial: EquityMemory | null = null): EquityStore {
  let memory = initial;
  return {
    async read() {
      return memory ? { ...memory } : null;
    },
    async write(next) {
      memory = { ...next };
    },
  };
}

export type LoopContext = {
  symbol: string;
  strategy: Strategy;
  gateway: BrokerGateway;
  feed: MarketFeed;
  orders: OrderStore;
  log: DecisionLog;
  killSwitch: KillSwitchStore;
  equity: EquityStore;
  policy: RiskPolicy;
  limits?: RiskLimits;
  now: () => string;
  /** Live gateways are refused unless this is explicitly true. Defaults to
   *  false, so reaching a real venue is always a deliberate act. */
  allowLive?: boolean;
};

export type CycleReport = {
  cycleId: string;
  at: string;
  halts: ActiveHalt[];
  decisions: DecisionRecord[];
  orderSubmitted: boolean;
  clientOrderId: string | null;
  /** Set when the cycle tripped the kill switch itself. */
  selfHalted: string | null;
};

let cycleCounter = 0;

export async function runCycle(ctx: LoopContext): Promise<CycleReport> {
  if (ctx.gateway.isLive && ctx.allowLive !== true) {
    throw new LiveGatewayRefusedError(ctx.gateway.name, "runCycle");
  }

  const at = ctx.now();
  const cycleId = `c${++cycleCounter}-${at}`;
  const halts: ActiveHalt[] = [];
  const decisions: DecisionRecord[] = [];
  let selfHalted: string | null = null;

  const record = async (
    phase: DecisionRecord["phase"],
    proceeded: boolean,
    summary: string,
    inputs: Record<string, unknown> = {},
    outputs: Record<string, unknown> = {},
    ai: DecisionRecord["ai"] = null,
  ) => {
    const stored = await ctx.log.append({
      at: ctx.now(),
      cycleId,
      phase,
      symbol: ctx.symbol,
      proceeded,
      summary,
      inputs,
      outputs,
      ai,
    });
    decisions.push(stored);
    return stored;
  };

  const finish = async (summary: string, orderSubmitted = false, clientOrderId: string | null = null) => {
    await record("cycle_end", orderSubmitted, summary, {}, { halts: halts.length });
    return { cycleId, at, halts, decisions, orderSubmitted, clientOrderId, selfHalted };
  };

  await record("cycle_start", true, `cycle for ${ctx.symbol}`, { symbol: ctx.symbol });

  // ---- kill switch ----
  const kill = await ctx.killSwitch.read();
  if (kill.engaged) {
    halts.push({ reason: "manual_kill_switch", detail: kill.reason ?? "engaged" });
    await record("kill_switch", false, `kill switch engaged by ${kill.by}: ${kill.reason}`, {}, { ...kill });
  } else {
    await record("kill_switch", true, "kill switch released", {}, { engaged: false });
  }

  // ---- reconcile against the broker ----
  const reconciliation = await reconcile({ gateway: ctx.gateway, store: ctx.orders, now: ctx.now });
  if (reconciliation.halt) {
    halts.push({ reason: reconciliation.halt.reason, detail: reconciliation.halt.detail });
  }
  await record(
    "reconcile",
    reconciliation.halt === null,
    reconciliation.halt ? reconciliation.halt.detail : "broker and local records agree",
    {},
    {
      reconciled: reconciliation.reconciled,
      brokerPositions: reconciliation.brokerPositions,
      localPositions: reconciliation.localPositions,
      discrepancies: reconciliation.discrepancies,
    },
  );

  // ---- account and market data ----
  let equityNow: number;
  try {
    const account = await ctx.gateway.getAccount();
    equityNow = account.equity;
  } catch (error) {
    halts.push({ reason: "connectivity", detail: `could not read account: ${String(error)}` });
    return finish("no account data; nothing attempted");
  }

  const day = at.slice(0, 10);
  const remembered = await ctx.equity.read();
  const memory: EquityMemory =
    remembered && remembered.day === day
      ? { ...remembered, peakEquity: Math.max(remembered.peakEquity, equityNow) }
      : {
          day,
          dayStartEquity: equityNow,
          peakEquity: Math.max(remembered?.peakEquity ?? equityNow, equityNow),
        };
  await ctx.equity.write(memory);

  let bars: Bar[];
  let quote: Quote | null;
  try {
    [bars, quote] = await Promise.all([ctx.feed.bars(ctx.symbol), ctx.feed.quote(ctx.symbol)]);
  } catch (error) {
    halts.push({ reason: "connectivity", detail: `market data unavailable: ${String(error)}` });
    await record("market_data", false, "market data unavailable", {}, { error: String(error) });
    return finish("no market data; nothing attempted");
  }

  await record(
    "market_data",
    bars.length >= ctx.strategy.warmupBars,
    `${bars.length} bars, quote ${quote ? `${quote.bid}/${quote.ask}` : "unavailable"}`,
    {},
    { barCount: bars.length, lastBar: bars[bars.length - 1]?.time ?? null, quote },
  );

  if (bars.length < ctx.strategy.warmupBars) {
    return finish(`only ${bars.length} bars, strategy needs ${ctx.strategy.warmupBars}`);
  }

  // ---- strategy ----
  // A signed quantity of 0 is the documented representation of flat. Treating
  // it as a position produces a phantom zero-quantity long that either freezes
  // the account out of entries or emits a 0-quantity close order.
  const brokerPosition = reconciliation.brokerPositions.find(
    (p) => p.symbol === ctx.symbol && p.quantity !== 0,
  );
  const position: Position | null = brokerPosition
    ? {
        symbol: brokerPosition.symbol,
        side: brokerPosition.quantity >= 0 ? "long" : "short",
        quantity: Math.abs(brokerPosition.quantity),
        avgEntryPrice: brokerPosition.averagePrice,
        stopPrice: null,
        targetPrice: null,
        openedAt: at,
        riskPerUnit: null,
      }
    : null;

  const decisionBar = bars[bars.length - 1];
  const signal: Signal = ctx.strategy.decide({
    symbol: ctx.symbol,
    bars: Object.freeze([...bars]),
    position,
    equity: equityNow,
  });

  await record(
    "signal",
    signal.action !== "hold",
    `${signal.action}: ${signal.rationale}`,
    { decisionBar: decisionBar.time, close: decisionBar.close, equity: equityNow, hasPosition: position !== null },
    { ...signal },
    // No AI in this strategy. When one is used, its verbatim prompt and
    // response belong here so the decision can be replayed exactly.
    null,
  );

  if (signal.action === "hold") return finish("strategy proposed no action");

  // ---- layer 1: sizing and the simulator's own risk manager ----
  // Layer 1 sees EVERY open position, not just this symbol's, or its
  // maxOpenPositions limit could never fire.
  const allPositions: Position[] = reconciliation.brokerPositions
    .filter((p) => p.quantity !== 0)
    .map((p) => ({
      symbol: p.symbol,
      side: p.quantity > 0 ? ("long" as const) : ("short" as const),
      quantity: Math.abs(p.quantity),
      avgEntryPrice: p.averagePrice,
      stopPrice: null,
      targetPrice: null,
      openedAt: at,
      riskPerUnit: null,
    }));

  // The daily-loss halt is EVALUATED, not rebuilt untripped each cycle. Passing
  // a fresh openTradingDay() here made maxDailyLossPct inert and left
  // assessSignal's kill_switch_tripped branch dead in live operation.
  const limits = ctx.limits ?? DEFAULT_RISK_LIMITS;
  const dayState = evaluateKillSwitch(
    openTradingDay(day, memory.dayStartEquity),
    equityNow,
    limits,
  );
  if (dayState.tripped) {
    halts.push({ reason: "risk_limit", detail: dayState.reason ?? "daily loss limit reached" });
  }

  const sized = assessSignal(signal, {
    equity: equityNow,
    cash: equityNow,
    referencePrice: decisionBar.close,
    positions: allPositions,
    killSwitch: dayState,
    limits,
    orderId: "pending",
  });

  if (!sized.approved) {
    await record("preflight", false, `sizing refused: ${sized.reason} — ${sized.detail}`, { ...signal }, { layer: "risk-manager", reason: sized.reason });
    return finish(`not sized: ${sized.reason}`);
  }

  // ---- layer 2: the independent risk gate ----
  const proposed: ProposedOrder = {
    symbol: ctx.symbol,
    side: sized.order.side,
    quantity: sized.order.quantity,
    intent: sized.order.intent,
    price: decisionBar.close,
  };

  const recentOrderTimes = (await ctx.orders.all())
    .filter((o) => o.status !== "pending")
    .map((o) => o.createdAt);

  const verdict = preflight(
    proposed,
    {
      // Fresh, not the cycle-start timestamp: a slow cycle would otherwise
      // understate the quote's age by however long it took to get here.
      at: ctx.now(),
      equity: equityNow,
      dayStartEquity: memory.dayStartEquity,
      peakEquity: memory.peakEquity,
      positions: reconciliation.brokerPositions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        notional: Math.abs(p.quantity * p.averagePrice),
      })),
      quote,
      recentOrderTimes,
      halts,
    },
    ctx.policy,
  );

  await record(
    "preflight",
    verdict.allowed,
    verdict.allowed
      ? `all ${verdict.checks.length} risk checks passed`
      : `refused: ${verdict.violations.map((v) => v.code).join(", ")}`,
    { ...proposed },
    { layer: "risk-control", checks: verdict.checks },
  );

  if (!verdict.allowed) return finish(`risk gate refused: ${verdict.violations.length} violation(s)`);

  // ---- submit ----
  const clientOrderId = deriveClientOrderId({
    strategy: ctx.strategy.name,
    symbol: ctx.symbol,
    decisionTime: decisionBar.time,
    intent: sized.order.intent,
    side: sized.order.side,
  });

  let result: Awaited<ReturnType<typeof submitOrder>>;
  try {
    result = await submitOrder(
      {
        clientOrderId,
        symbol: ctx.symbol,
        side: sized.order.side,
        quantity: sized.order.quantity,
        intent: sized.order.intent,
        stopPrice: sized.order.stopPrice,
        takeProfitPrice: sized.order.targetPrice,
        reason: signal.rationale,
      },
      { gateway: ctx.gateway, store: ctx.orders, now: ctx.now },
    );
  } catch (error) {
    // An adapter that throws mid-submit leaves exactly the same uncertainty as
    // a timeout: the order may be live. Escaping runCycle here would skip the
    // halt and resume trading next cycle around a possibly-open position.
    const detail =
      `submit threw for ${clientOrderId}: ${error instanceof Error ? error.message : String(error)}`;
    selfHalted = detail;
    await engage(ctx.killSwitch, detail, "loop:submit_threw", ctx.now());
    halts.push({ reason: "unresolved_order", detail });
    await record("submit", false, detail, { clientOrderId }, { threw: true });
    return finish("halted: submit threw", false, clientOrderId);
  }

  await record(
    "submit",
    result.outcome === "accepted",
    `${result.outcome}: ${sized.order.side} ${sized.order.quantity} ${ctx.symbol}`,
    { clientOrderId, quantity: sized.order.quantity, stopPrice: sized.order.stopPrice },
    { outcome: result.outcome, status: result.record.status, brokerOrderId: result.record.brokerOrderId },
  );

  if (result.outcome === "unresolved") {
    // An order that may or may not be live is the one condition that stops the
    // system on its own authority. Continuing to trade around an unknown
    // position is how one bad cycle becomes several.
    selfHalted = result.halt.detail;
    await engage(ctx.killSwitch, result.halt.detail, "loop:unresolved_order", ctx.now());
    halts.push({ reason: "unresolved_order", detail: result.halt.detail });
    return finish("halted: order outcome unknown", false, clientOrderId);
  }

  return finish(
    `cycle complete: ${result.outcome}`,
    result.outcome === "accepted" || result.outcome === "duplicate",
    clientOrderId,
  );
}
