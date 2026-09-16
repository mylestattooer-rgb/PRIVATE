import { describe, expect, it } from "vitest";
import { applyFill, applyFinancing, computeEquity, emptyAccount, marketValue, unrealizedPnl } from "./portfolio";
import type { Fill, Order, Position } from "./types";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o-1",
  symbol: "AAPL",
  side: "buy",
  quantity: 10,
  intent: "open",
  positionSide: "long",
  stopPrice: 98,
  targetPrice: 120,
  riskAmount: 20,
  source: "rule",
  ...overrides,
});

const fill = (overrides: Partial<Fill> = {}): Fill => ({
  orderId: "o-1",
  symbol: "AAPL",
  side: "buy",
  quantity: 10,
  price: 100,
  commission: 2,
  slippage: 0,
  time: "2026-01-02T00:00:00.000Z",
  intent: "open",
  positionSide: "long",
  ...overrides,
});

const openLong = () => applyFill(emptyAccount(10_000), order(), fill());

describe("long round trip", () => {
  it("debits cost and commission on entry", () => {
    const { account, closed } = openLong();
    expect(account.cash).toBe(8_998);
    expect(closed).toBeNull();
    expect(account.positions).toHaveLength(1);
    expect(account.positions[0].avgEntryPrice).toBe(100);
  });

  it("measures risk per unit from the fill price, not the intended price", () => {
    // Filled at 101 against a stop of 98 — the real risk taken is 3, not 2.
    const { account } = applyFill(emptyAccount(10_000), order(), fill({ price: 101 }));
    expect(account.positions[0].riskPerUnit).toBe(3);
  });

  it("realizes profit net of commission on exit", () => {
    const opened = openLong();
    const closeOrder = order({ id: "o-2", side: "sell", intent: "close" });
    const closeFill = fill({ orderId: "o-2", side: "sell", intent: "close", price: 110 });
    const { account, closed } = applyFill(opened.account, closeOrder, closeFill, "target");

    expect(closed).not.toBeNull();
    expect(closed!.grossPnl).toBe(100);
    expect(closed!.netPnl).toBe(98);
    expect(closed!.result).toBe("win");
    expect(closed!.exitReason).toBe("target");
    expect(account.cash).toBe(10_096);
    expect(account.realizedPnl).toBe(98);
    expect(account.commissionPaid).toBe(4);
    expect(account.positions).toHaveLength(0);
  });

  it("computes R net of costs, against the risk frozen at entry", () => {
    const opened = openLong();
    const closeFill = fill({ side: "sell", intent: "close", price: 110 });
    const { closed } = applyFill(opened.account, order({ side: "sell", intent: "close" }), closeFill);
    // 98 net over 2 of risk per unit across 10 units = 4.9R.
    expect(closed!.rMultiple).toBe(4.9);
  });

  it("reports a null R when the position carried no stop", () => {
    const opened = applyFill(emptyAccount(10_000), order({ stopPrice: null }), fill());
    const { closed } = applyFill(
      opened.account,
      order({ side: "sell", intent: "close" }),
      fill({ side: "sell", intent: "close", price: 110 }),
    );
    expect(closed!.rMultiple).toBeNull();
  });
});

describe("short round trip", () => {
  const shortOrder = order({ side: "sell", positionSide: "short", stopPrice: 110 });
  const shortFill = fill({ side: "sell", positionSide: "short" });

  it("credits proceeds on entry", () => {
    const { account } = applyFill(emptyAccount(10_000), shortOrder, shortFill);
    expect(account.cash).toBe(10_998);
    expect(account.positions[0].side).toBe("short");
  });

  it("leaves equity unchanged apart from commission while the price is unmoved", () => {
    const { account } = applyFill(emptyAccount(10_000), shortOrder, shortFill);
    expect(computeEquity(account, { AAPL: 100 })).toBe(9_998);
  });

  it("gains as the price falls", () => {
    const { account } = applyFill(emptyAccount(10_000), shortOrder, shortFill);
    expect(computeEquity(account, { AAPL: 90 })).toBe(10_098);
  });

  it("realizes profit when bought back lower", () => {
    const opened = applyFill(emptyAccount(10_000), shortOrder, shortFill);
    const { account, closed } = applyFill(
      opened.account,
      order({ side: "buy", positionSide: "short", intent: "close" }),
      fill({ side: "buy", positionSide: "short", intent: "close", price: 90 }),
    );
    expect(closed!.grossPnl).toBe(100);
    expect(closed!.netPnl).toBe(98);
    expect(account.cash).toBe(10_096);
  });

  it("realizes a loss when bought back higher", () => {
    const opened = applyFill(emptyAccount(10_000), shortOrder, shortFill);
    const { closed } = applyFill(
      opened.account,
      order({ side: "buy", positionSide: "short", intent: "close" }),
      fill({ side: "buy", positionSide: "short", intent: "close", price: 110 }),
    );
    expect(closed!.netPnl).toBe(-102);
    expect(closed!.result).toBe("loss");
  });
});

describe("partial close", () => {
  it("realizes only the closed portion and leaves the rest open", () => {
    const opened = openLong();
    const { account, closed } = applyFill(
      opened.account,
      order({ side: "sell", intent: "close", quantity: 4 }),
      fill({ side: "sell", intent: "close", quantity: 4, price: 110 }),
    );
    expect(closed!.quantity).toBe(4);
    expect(closed!.grossPnl).toBe(40);
    expect(account.positions).toHaveLength(1);
    expect(account.positions[0].quantity).toBe(6);
    expect(account.positions[0].avgEntryPrice).toBe(100);
  });
});

describe("guards", () => {
  it("refuses to open on top of an existing position", () => {
    const opened = openLong();
    expect(() => applyFill(opened.account, order({ id: "o-2" }), fill({ orderId: "o-2" }))).toThrow(
      /already open/,
    );
  });

  it("refuses to close what is not open", () => {
    expect(() =>
      applyFill(
        emptyAccount(10_000),
        order({ side: "sell", intent: "close" }),
        fill({ side: "sell", intent: "close" }),
      ),
    ).toThrow(/no open position/);
  });

  it("refuses to close more than is open", () => {
    const opened = openLong();
    expect(() =>
      applyFill(
        opened.account,
        order({ side: "sell", intent: "close", quantity: 99 }),
        fill({ side: "sell", intent: "close", quantity: 99 }),
      ),
    ).toThrow(/only 10 open/);
  });

  it("does not mutate the account it was given", () => {
    const before = emptyAccount(10_000);
    applyFill(before, order(), fill());
    expect(before.cash).toBe(10_000);
    expect(before.positions).toHaveLength(0);
  });
});

describe("valuation helpers", () => {
  const long: Position = {
    symbol: "AAPL",
    side: "long",
    quantity: 10,
    avgEntryPrice: 100,
    stopPrice: null,
    targetPrice: null,
    openedAt: "2026-01-01T00:00:00.000Z",
    riskPerUnit: null,
  };

  it("values a long positively and a short negatively", () => {
    expect(marketValue(long, 110)).toBe(1_100);
    expect(marketValue({ ...long, side: "short" }, 110)).toBe(-1_100);
  });

  it("signs unrealized PnL by direction", () => {
    expect(unrealizedPnl(long, 110)).toBe(100);
    expect(unrealizedPnl({ ...long, side: "short" }, 110)).toBe(-100);
  });

  it("falls back to entry price when a mark is missing", () => {
    const account = { cash: 0, positions: [long], realizedPnl: 0, commissionPaid: 0, financingPaid: 0 };
    expect(computeEquity(account, {})).toBe(1_000);
  });
});

describe("applyFinancing", () => {
  const withPosition = () => applyFill(emptyAccount(10_000), order(), fill()).account;

  it("charges financing on gross notional and tracks it apart from commission", () => {
    const charged = applyFinancing(withPosition(), { AAPL: 100 }, 1);
    // 10 units at 100 = 1000 notional, 1bp = 0.10.
    expect(charged.financingPaid).toBe(0.1);
    expect(charged.cash).toBe(8_997.9);
    expect(charged.commissionPaid).toBe(2);
  });

  it("charges the short side too, rather than crediting it", () => {
    const short = applyFill(
      emptyAccount(10_000),
      order({ side: "sell", positionSide: "short", stopPrice: 110 }),
      fill({ side: "sell", positionSide: "short" }),
    ).account;
    expect(applyFinancing(short, { AAPL: 100 }, 1).financingPaid).toBe(0.1);
  });

  it("compounds across periods, which is how a slow strategy bleeds out", () => {
    let account = withPosition();
    for (let day = 0; day < 10; day++) account = applyFinancing(account, { AAPL: 100 }, 1);
    expect(account.financingPaid).toBeCloseTo(1, 6);
  });

  it("is a no-op with no positions or a zero rate", () => {
    expect(applyFinancing(emptyAccount(10_000), {}, 5).financingPaid).toBe(0);
    expect(applyFinancing(withPosition(), { AAPL: 100 }, 0).financingPaid).toBe(0);
  });

  it("falls back to entry price when a mark is missing", () => {
    expect(applyFinancing(withPosition(), {}, 1).financingPaid).toBe(0.1);
  });
});
