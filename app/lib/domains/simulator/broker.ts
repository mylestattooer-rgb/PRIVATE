// Execution adapters — the only place an Order becomes a Fill.
//
// The interface is async and provider-shaped on purpose: a real adapter
// (MetaTrader 5 bridge, Alpaca, IBKR) implements exactly this and drops into
// the same runner. `isLive` is the load-bearing field. Anything that can move
// real money must declare `isLive: true`, and the backtest runner refuses to
// execute against one — a backtest against a live broker is never a thing
// anyone meant to do, and it should fail loudly rather than send orders.

import { roundCash, roundPrice } from "./money";
import type { Bar, Fill, Order } from "./types";

export type ExecutionContext = {
  /** The bar the order executes against. For the paper broker this is the bar
   *  AFTER the one the strategy decided on — see backtest.ts on look-ahead. */
  bar: Bar;
  /** Overrides the bar open as the reference price. The runner sets this for
   *  resting stop and target orders, which fill where they were touched (or at
   *  the open, if the bar gapped through them) rather than at the open. */
  fillPrice?: number;
};

export type ExecutionAdapter = {
  readonly name: string;
  /** True when this adapter transacts with real funds at a real venue. */
  readonly isLive: boolean;
  /** Returns the resulting fill, or null when the order could not be executed. */
  submit(order: Order, ctx: ExecutionContext): Promise<Fill | null>;
};

export type CommissionModel = {
  perUnit: number;
  percentOfNotional: number;
  minimum: number;
};

export const ZERO_COMMISSION: CommissionModel = { perUnit: 0, percentOfNotional: 0, minimum: 0 };

/** Retail-equity-ish defaults: no per-share fee, a small spread cost, and a
 *  floor so tiny trades are not free. Override per instrument — FX and CFDs
 *  price very differently. */
export const DEFAULT_COMMISSION: CommissionModel = {
  perUnit: 0,
  percentOfNotional: 0.02,
  minimum: 1,
};

export type PaperBrokerConfig = {
  /** Adverse price movement applied to every fill, in basis points of price.
   *  Models spread and market impact together; a deliberately blunt instrument. */
  slippageBps: number;
  commission: CommissionModel;
};

export const DEFAULT_PAPER_CONFIG: PaperBrokerConfig = {
  slippageBps: 5,
  commission: DEFAULT_COMMISSION,
};

export function computeCommission(quantity: number, price: number, model: CommissionModel): number {
  const raw = quantity * model.perUnit + quantity * price * (model.percentOfNotional / 100);
  return roundCash(Math.max(raw, model.minimum));
}

/** Slippage always works against the order: buys fill higher, sells fill lower. */
export function applySlippage(price: number, side: Order["side"], slippageBps: number): number {
  const factor = side === "buy" ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
  return roundPrice(price * factor);
}

/**
 * Simulated execution against bar data.
 *
 * Market orders fill at the execution bar's OPEN, plus slippage. Using the open
 * — not the close, and not the decision bar's price — is what keeps the
 * simulation honest: it is the first price genuinely available after the
 * decision was made.
 */
export function createPaperBroker(config: PaperBrokerConfig = DEFAULT_PAPER_CONFIG): ExecutionAdapter {
  return {
    name: "paper",
    isLive: false,
    async submit(order, ctx) {
      const reference = ctx.fillPrice ?? ctx.bar.open;
      if (!Number.isFinite(reference) || reference <= 0) return null;

      const price = applySlippage(reference, order.side, config.slippageBps);
      return {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        price,
        commission: computeCommission(order.quantity, price, config.commission),
        slippage: roundPrice(price - reference),
        time: ctx.bar.time,
        intent: order.intent,
        positionSide: order.positionSide,
      };
    },
  };
}

/** Fills exactly at the reference price with no costs. Useful for tests that
 *  assert accounting rather than execution quality — never for judging a
 *  strategy, since frictionless results are fiction. */
export function createIdealBroker(): ExecutionAdapter {
  return createPaperBroker({ slippageBps: 0, commission: ZERO_COMMISSION });
}
