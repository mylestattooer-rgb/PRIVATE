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
