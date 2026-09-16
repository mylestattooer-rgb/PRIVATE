export { alignSeries, realisedVol, simpleReturns, trailingReturn } from "./series";
export type { AlignedSeries } from "./series";
export {
  annualisedReturn,
  annualisedVol,
  correlation,
  effectiveBreadth,
  maxDrawdown,
  sharpe,
} from "./stats";
export { CANONICAL_TSMOM, momentumSignal, volScaledWeight, warmupBars } from "./tsmom";
export type { SignalMode, TsmomConfig } from "./tsmom";
export { FREE, runPortfolio } from "./portfolio";
export type { PortfolioCosts, PortfolioResult, RunOptions } from "./portfolio";
export { parseMt5Export, spreadPointsToBps } from "./mt5-import";
export type { Mt5Bar, Mt5ImportOptions, Mt5ImportResult, SpreadSummary } from "./mt5-import";
