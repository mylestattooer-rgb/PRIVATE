// Public surface of the simulator domain. Other domains and route handlers
// import from here, not from individual files — the same convention
// entitlements/ follows.

export type {
  AccountState,
  Bar,
  ClosedTrade,
  EquityPoint,
  ExitReason,
  Fill,
  Order,
  OrderIntent,
  OrderSide,
  Position,
  PositionSide,
  Signal,
  SignalAction,
  SignalSource,
} from "./types";

export { parseSignal, holdSignal, isEntryAction, SIGNAL_ACTIONS, MAX_RATIONALE_LENGTH } from "./signal";
export type { SignalParseResult } from "./signal";

export {
  assessSignal,
  evaluateKillSwitch,
  openTradingDay,
  sizePosition,
  DEFAULT_RISK_LIMITS,
} from "./risk";
export type { KillSwitchState, RiskContext, RiskDecision, RiskLimits, RiskRejectionReason } from "./risk";

export {
  createPaperBroker,
  createIdealBroker,
  applySlippage,
  computeCommission,
  DEFAULT_COMMISSION,
  DEFAULT_PAPER_CONFIG,
  ZERO_COMMISSION,
} from "./broker";
export type { CommissionModel, ExecutionAdapter, ExecutionContext, PaperBrokerConfig } from "./broker";

export {
  assertValidSeries,
  createInMemoryDataSource,
  isValidBar,
  parseCsvBars,
} from "./datasource";
export type { BarRange, MarketDataSource } from "./datasource";

export { applyFill, computeEquity, emptyAccount, findPosition, marketValue, unrealizedPnl } from "./portfolio";
export { computeMetrics, maxDrawdown, profitFactor, sharpeRatio } from "./metrics";
export type { BacktestMetrics } from "./metrics";

export { runBacktest, resolveExit, LiveExecutionError } from "./backtest";
export type { BacktestConfig, BacktestResult, RejectionRecord, Strategy, StrategyContext } from "./backtest";

export { atr, crossedAbove, crossedBelow, sma, trueRange } from "./indicators";
export { createSmaCrossoverStrategy, DEFAULT_SMA_CONFIG } from "./strategies/sma-crossover";
export type { SmaCrossoverConfig } from "./strategies/sma-crossover";
