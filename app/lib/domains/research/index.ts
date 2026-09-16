export { alignSeries, barsPerYear, realisedVol, simpleReturns, trailingReturn } from "./series";
export type { AlignedSeries } from "./series";
export {
  annualisedReturn,
  annualisedVol,
  correlation,
  effectiveBreadth,
  maxDrawdown,
  sharpe,
} from "./stats";
export { calibrate, CANONICAL_TSMOM, CANONICAL_TSMOM_SPEC, momentumSignal, volScaledWeight, warmupBars } from "./tsmom";
export type { SignalMode, TsmomConfig, TsmomSpec } from "./tsmom";
export { FREE, runPortfolio } from "./portfolio";
export type { PortfolioCosts, PortfolioResult, RunOptions } from "./portfolio";
export { aggregateToDaily, isIntraday, parseMt5Export, spreadPointsToBps } from "./mt5-import";
export type { AggregateOptions, Mt5Bar, Mt5ImportOptions, Mt5ImportResult, SpreadSummary } from "./mt5-import";
export { breakEvenHitRate, classify, hourlyProfile } from "./intraday";
export type { Feasibility, Horizon, HorizonStat, HourProfile } from "./intraday";
