// Account bookkeeping. Pure and immutable: every function returns a new
// AccountState rather than mutating, so the backtest runner can keep an
// equity curve of real snapshots instead of copies of one drifting object.
//
// Cash model, stated explicitly because short accounting is where these things
// usually go quietly wrong:
//
//   open long    cash −= qty×price + commission      market value = +qty×mark
//   close long   cash += qty×price − commission
//   open short   cash += qty×price − commission      market value = −qty×mark
//   close short  cash −= qty×price + commission
//
// Equity is cash plus market value, so an unmoved short nets to exactly the
// pre-trade equity (the credited proceeds and the liability cancel) and a
// favourable move shows up as profit. No margin, no borrow cost, no interest —
// see README.md in this folder for the full list of what the model omits.

import { roundCash } from "./money";
import type { AccountState, ClosedTrade, ExitReason, Fill, Order, Position } from "./types";

export function emptyAccount(startingCash: number): AccountState {
  return { cash: startingCash, positions: [], realizedPnl: 0, commissionPaid: 0, financingPaid: 0 };
}

export function marketValue(position: Position, markPrice: number): number {
  const notional = position.quantity * markPrice;
  return position.side === "long" ? notional : -notional;
}

export function unrealizedPnl(position: Position, markPrice: number): number {
  const perUnit =
    position.side === "long"
      ? markPrice - position.avgEntryPrice
      : position.avgEntryPrice - markPrice;
  return perUnit * position.quantity;
}

/** Mark-to-market account value. `marks` must price every open position; a
 *  missing mark falls back to the entry price rather than silently valuing the
 *  position at zero. */
export function computeEquity(account: AccountState, marks: Record<string, number>): number {
  const positionsValue = account.positions.reduce(
    (sum, p) => sum + marketValue(p, marks[p.symbol] ?? p.avgEntryPrice),
    0,
  );
  return roundCash(account.cash + positionsValue);
}

export function findPosition(account: AccountState, symbol: string): Position | null {
  return account.positions.find((p) => p.symbol === symbol) ?? null;
}

function classify(netPnl: number): ClosedTrade["result"] {
  if (netPnl > 0) return "win";
  if (netPnl < 0) return "loss";
  return "breakeven";
}

export type ApplyFillResult = { account: AccountState; closed: ClosedTrade | null };

/**
 * Apply one fill to the account.
 *
 * Opening fills create (or are rejected against) a position; closing fills
 * realize PnL and emit a ClosedTrade. Partial closes are supported and realize
 * only the closed portion, leaving the remainder open at the same entry.
 *
 * `order` is required alongside `fill` because stop/target live on the order —
 * a fill is only ever a price and a quantity, which is also true of every real
 * broker's fill payload.
 */
export function applyFill(
  account: AccountState,
  order: Order,
  fill: Fill,
  exitReason: ExitReason = "signal",
): ApplyFillResult {
  const gross = fill.quantity * fill.price;
  const existing = findPosition(account, fill.symbol);

  if (fill.intent === "open") {
    if (existing) {
      throw new Error(
        `applyFill: refusing to open ${fill.symbol} while a position is already open — ` +
          `risk.assessSignal should have rejected this as already_in_position`,
      );
    }

    const position: Position = {
      symbol: fill.symbol,
      side: fill.positionSide,
      quantity: fill.quantity,
      avgEntryPrice: fill.price,
      stopPrice: order.stopPrice,
      targetPrice: order.targetPrice,
      openedAt: fill.time,
      // Measured from the price actually filled, not the price the strategy
      // saw, so R-multiples reflect the risk genuinely taken on.
      riskPerUnit: order.stopPrice === null ? null : Math.abs(fill.price - order.stopPrice),
    };

    return {
      account: {
        cash: roundCash(
          fill.positionSide === "long"
            ? account.cash - gross - fill.commission
            : account.cash + gross - fill.commission,
        ),
        positions: [...account.positions, position],
        realizedPnl: account.realizedPnl,
        commissionPaid: roundCash(account.commissionPaid + fill.commission),
        financingPaid: account.financingPaid,
      },
      closed: null,
    };
  }

  if (!existing) {
    throw new Error(`applyFill: no open position in ${fill.symbol} to close`);
  }
  if (fill.quantity > existing.quantity) {
    throw new Error(
      `applyFill: cannot close ${fill.quantity} of ${fill.symbol}, only ${existing.quantity} open`,
    );
  }

  const perUnitPnl =
    existing.side === "long"
      ? fill.price - existing.avgEntryPrice
      : existing.avgEntryPrice - fill.price;
  const grossPnl = perUnitPnl * fill.quantity;
  const netPnl = grossPnl - fill.commission;

  const remaining = existing.quantity - fill.quantity;
  const positions =
    remaining > 0
      ? account.positions.map((p) => (p.symbol === fill.symbol ? { ...p, quantity: remaining } : p))
      : account.positions.filter((p) => p.symbol !== fill.symbol);

  const closed: ClosedTrade = {
    symbol: existing.symbol,
    side: existing.side,
    quantity: fill.quantity,
    entryPrice: existing.avgEntryPrice,
    exitPrice: fill.price,
    entryTime: existing.openedAt,
    exitTime: fill.time,
    grossPnl: roundCash(grossPnl),
    commission: roundCash(fill.commission),
    netPnl: roundCash(netPnl),
    // Net of costs on purpose: an R-multiple that ignores commission flatters
    // every strategy, and small-account slippage is exactly what kills them.
    rMultiple:
      existing.riskPerUnit && existing.riskPerUnit > 0
        ? Number((netPnl / (existing.riskPerUnit * fill.quantity)).toFixed(4))
        : null,
    result: classify(netPnl),
    exitReason,
    source: order.source,
    setupTag: null,
    mistakeTag: null,
  };

  return {
    account: {
      cash: roundCash(
        existing.side === "long"
          ? account.cash + gross - fill.commission
          : account.cash - gross - fill.commission,
      ),
      positions,
      realizedPnl: roundCash(account.realizedPnl + netPnl),
      commissionPaid: roundCash(account.commissionPaid + fill.commission),
      financingPaid: account.financingPaid,
    },
    closed,
  };
}

/**
 * Charge one period of overnight financing on every open position.
 *
 * Applied to gross notional and to BOTH directions. On a retail CFD account the
 * short side rarely earns carry once the broker's markup is taken out, so
 * crediting shorts would flatter every short-biased strategy. Charging both is
 * the pessimistic and more usually correct choice; a venue that genuinely pays
 * the short side needs a signed rate here instead.
 *
 * This is the cost that makes a slow strategy lose money while its entry logic
 * looks fine, and the simulator had no model of it at all before this.
 */
export function applyFinancing(
  account: AccountState,
  marks: Record<string, number>,
  bpsPerPeriod: number,
): AccountState {
  if (bpsPerPeriod <= 0 || account.positions.length === 0) return account;

  const charge = account.positions.reduce((sum, p) => {
    const mark = marks[p.symbol] ?? p.avgEntryPrice;
    return sum + Math.abs(p.quantity * mark) * (bpsPerPeriod / 10_000);
  }, 0);

  return {
    ...account,
    cash: roundCash(account.cash - charge),
    financingPaid: roundCash(account.financingPaid + charge),
  };
}
