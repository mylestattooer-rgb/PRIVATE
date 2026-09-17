// Operator view: what the system holds, what is stopping it, and why it did
// what it did.
//
// Rendered as text so it works over SSH, in a log file, and in CI output — the
// places an unattended system is actually inspected from. It is a pure function
// of a model, so a web view later renders the same model rather than
// reimplementing the reasoning.
//
// The "why" column is the point. A dashboard that shows positions but not the
// reason for each decision cannot answer the only question that matters after a
// quiet night: was it correct to do nothing?

import type { BrokerPosition, OrderRecord } from "../execution/types";
import type { ActiveHalt } from "../riskcontrol";
import type { DecisionRecord } from "./decision-log";
import type { KillSwitchState } from "./kill-switch";
import type { EquityMemory } from "./loop";

export type DashboardModel = {
  at: string;
  symbol: string;
  killSwitch: KillSwitchState;
  halts: ActiveHalt[];
  positions: BrokerPosition[];
  openOrders: OrderRecord[];
  recentDecisions: DecisionRecord[];
  equity: EquityMemory | null;
  accountEquity: number | null;
};

const WIDTH = 78;
const rule = (char = "─") => char.repeat(WIDTH);

function statusLine(model: DashboardModel): string {
  if (model.killSwitch.engaged) return `HALTED — kill switch: ${model.killSwitch.reason ?? "engaged"}`;
  if (model.halts.length > 0) return `STANDING DOWN — ${model.halts.map((h) => h.reason).join(", ")}`;
  return "RUNNING — no active halts";
}

export function renderDashboard(model: DashboardModel): string {
  const lines: string[] = [];

  lines.push(rule("═"));
  lines.push(`  ${model.symbol}   ${model.at}`);
  lines.push(`  ${statusLine(model)}`);
  lines.push(rule("═"));

  if (model.accountEquity !== null) {
    const peak = model.equity?.peakEquity ?? model.accountEquity;
    const drawdown = peak > 0 ? ((peak - model.accountEquity) / peak) * 100 : 0;
    lines.push(
      `  equity $${model.accountEquity.toFixed(2)}   peak $${peak.toFixed(2)}   drawdown ${drawdown.toFixed(2)}%`,
    );
    lines.push("");
  }

  lines.push("  POSITIONS");
  // Working orders are shown here, not only under OPEN ORDERS, because the two
  // read as a contradiction otherwise: an operator sees "flat" while the
  // decision log says "already in position" and has to reconcile that at
  // whatever hour it is. Risk limits count working quantity as exposure, so the
  // screen that explains the system's behaviour has to show the same thing.
  const working = model.openOrders.reduce((bySymbol, o) => {
    const residual = o.quantity - o.filledQuantity;
    if (residual <= 0) return bySymbol;
    const signed = o.side === "buy" ? residual : -residual;
    bySymbol.set(o.symbol, (bySymbol.get(o.symbol) ?? 0) + signed);
    return bySymbol;
  }, new Map<string, number>());

  if (model.positions.length === 0 && working.size === 0) {
    lines.push("    flat");
  } else {
    for (const p of model.positions) {
      // 0 is flat, not long — see loop.ts on phantom zero-quantity positions.
      const side = p.quantity === 0 ? "flat" : p.quantity > 0 ? "long" : "short";
      lines.push(`    ${p.symbol.padEnd(10)} ${side.padEnd(6)} ${Math.abs(p.quantity)} @ ${p.averagePrice}`);
    }
  }

  for (const [symbol, quantity] of [...working.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const side = quantity > 0 ? "long" : "short";
    lines.push(
      `    ${symbol.padEnd(10)} ${side.padEnd(6)} ${Math.abs(quantity)} WORKING (ordered, not yet filled — counts against limits)`,
    );
  }

  if (model.openOrders.length > 0) {
    lines.push("");
    lines.push("  OPEN ORDERS");
    for (const o of model.openOrders) {
      lines.push(
        `    ${o.clientOrderId}  ${o.side} ${o.quantity} ${o.symbol}  ${o.status}` +
          (o.filledQuantity > 0 ? `  (filled ${o.filledQuantity})` : ""),
      );
    }
  }

  if (model.halts.length > 0) {
    lines.push("");
    lines.push("  WHY IT IS NOT OPENING NEW POSITIONS");
    for (const h of model.halts) lines.push(`    ${h.reason}: ${h.detail}`);
  }

  lines.push("");
  lines.push("  RECENT DECISIONS");
  if (model.recentDecisions.length === 0) {
    lines.push("    none recorded");
  } else {
    for (const d of model.recentDecisions) {
      lines.push(`    ${d.at.slice(11, 19)}  ${d.proceeded ? " " : "✕"} ${d.phase.padEnd(13)} ${d.summary}`);
    }
  }

  lines.push(rule());
  return lines.join("\n");
}
