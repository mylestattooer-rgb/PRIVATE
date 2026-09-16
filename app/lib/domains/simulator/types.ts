// Core simulator types. Deliberately free of Prisma, Next, and network imports:
// every module in this domain is pure, synchronous and testable in isolation
// (ARCHITECTURE.md's "deterministic core, pluggable domains").
//
// The type layer encodes one boundary the docs already state as a rule
// (AI_ARCHITECTURE.md, "Hard boundary"): a Signal is *intent only*. It carries
// no quantity, no cash and no order id, so no strategy — LLM-driven or not —
// can express "buy 400 shares". Sizing exists solely in risk.ts, which is the
// only module that can turn a Signal into an Order.

/** A single OHLCV bar. `time` is the ISO-8601 UTC timestamp of the bar's OPEN. */
export type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PositionSide = "long" | "short";

export type SignalAction = "enter_long" | "enter_short" | "exit" | "hold";

/** Where a signal came from. Recorded on every fill so an audit can separate
 *  rule-driven decisions from AI-suggested ones after the fact. */
export type SignalSource = "rule" | "ai";

export type Signal = {
  symbol: string;
  action: SignalAction;
  /** 0..1. The Risk Manager rejects anything under its configured floor. */
  confidence: number;
  /** Where the idea is wrong. Required for entries — risk.ts cannot size a
   *  position without it, and refuses rather than inventing one. */
  stopPrice: number | null;
  targetPrice: number | null;
  rationale: string;
  source: SignalSource;
};

export type OrderSide = "buy" | "sell";

/** Whether this order establishes exposure or removes it. Kept explicit rather
 *  than inferred from side, so the kill switch can permit closes while blocking
 *  opens without re-deriving intent from account state. */
export type OrderIntent = "open" | "close";

export type Order = {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Whole units, always > 0. */
  quantity: number;
  intent: OrderIntent;
  positionSide: PositionSide;
  stopPrice: number | null;
  targetPrice: number | null;
  /** Cash the Risk Manager sized this order to put at risk (entry→stop
   *  distance × quantity). 0 for closing orders. */
  riskAmount: number;
  source: SignalSource;
};

export type Fill = {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  /** Price actually paid/received, slippage already applied. */
  price: number;
  commission: number;
  /** Signed difference between `price` and the reference price, for cost analysis. */
  slippage: number;
  time: string;
  intent: OrderIntent;
  positionSide: PositionSide;
};

export type Position = {
  symbol: string;
  side: PositionSide;
  quantity: number;
  avgEntryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  openedAt: string;
  /** Per-unit risk at entry (|entry − stop|), frozen so R-multiples stay
   *  anchored to the risk actually taken rather than a later re-derivation. */
  riskPerUnit: number | null;
};

export type AccountState = {
  cash: number;
  positions: Position[];
  realizedPnl: number;
  commissionPaid: number;
};

export type ExitReason = "stop" | "target" | "signal" | "end_of_data" | "kill_switch";

/** A round trip, shaped to match journal/stats.ts's `StatTrade` so simulator
 *  results feed the existing journal statistics without a translation layer. */
export type ClosedTrade = {
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  grossPnl: number;
  commission: number;
  netPnl: number;
  /** null when the position was opened with no stop (risk basis unknown). */
  rMultiple: number | null;
  result: "win" | "loss" | "breakeven";
  exitReason: ExitReason;
  source: SignalSource;
  /** Which strategy produced the trade. Populated by the backtest runner, and
   *  what makes journal/stats.ts's best/worst-setup ranking meaningful across a
   *  multi-strategy run. */
  setupTag: string | null;
  /** Always null for simulated trades — a mistake tag is a human judgement a
   *  student adds afterwards. Present so a ClosedTrade satisfies the journal
   *  domain's StatTrade shape without a translation layer. */
  mistakeTag: string | null;
};

export type EquityPoint = { time: string; equity: number; cash: number };
