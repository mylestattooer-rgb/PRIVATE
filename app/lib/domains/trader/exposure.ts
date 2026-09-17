// Combining what is held with what is merely ordered.
//
// Two different questions get asked of "the position", and conflating them is
// how both of this module's bugs happened:
//
//   "May I open more?"   -> count orders still working. An unfilled order is
//                           about to be a position, and a limit that ignores it
//                           can be breached by simply being slow to fill.
//   "Have I something    -> count ONLY what is filled. You cannot close what
//    to close?"             the broker has not given you; a sell against an
//                           unfilled buy opens a short.
//
// So the two are kept apart at the type level and recombined only where the
// question is the first one.

import type { PositionQuantity } from "../execution";

export type Exposure = {
  symbol: string;
  /** Signed worst-case quantity: positive long, negative short. */
  quantity: number;
  /** Price to value it at. The broker's average where held, else the decision price. */
  price: number;
};

/**
 * Worst-case signed exposure per symbol, given filled positions and working
 * orders.
 *
 * **Working orders are not netted against each other.** The first version of
 * this netted a working close against the position it was closing and reported
 * zero — but the worst case for a long limit is precisely that the close does
 * NOT fill while a new entry does. So each side is evaluated on its own and the
 * larger magnitude wins:
 *
 *     worst long  = held + (working buys)
 *     worst short = held + (working sells)
 *
 * Not netting cannot trap a position, because neither risk layer gates an exit:
 * `preflight` short-circuits `intent: "close"` to allowed before any check
 * runs, and `assessSignal` approves an exit before it consults a limit. The
 * conservative number can only ever refuse to open.
 */
export function worstCaseExposure(
  held: readonly { symbol: string; quantity: number; averagePrice: number }[],
  working: readonly PositionQuantity[],
  fallbackPrice: number,
): Exposure[] {
  const symbols = new Set<string>([...held.map((h) => h.symbol), ...working.map((w) => w.symbol)]);
  const out: Exposure[] = [];

  for (const symbol of symbols) {
    const position = held.find((h) => h.symbol === symbol);
    const base = position?.quantity ?? 0;

    let buys = 0;
    let sells = 0;
    for (const w of working) {
      if (w.symbol !== symbol) continue;
      if (w.quantity > 0) buys += w.quantity;
      else sells += w.quantity;
    }

    const long = base + buys;
    const short = base + sells;
    const quantity = Math.abs(long) >= Math.abs(short) ? long : short;
    if (quantity === 0) continue;

    out.push({ symbol, quantity, price: position?.averagePrice ?? fallbackPrice });
  }

  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
