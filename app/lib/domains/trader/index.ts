// Public surface of the trader domain — the unattended loop and its operator
// surfaces.

export { createInMemoryDecisionLog, formatDecisions } from "./decision-log";
export type { DecisionLog, DecisionPhase, DecisionRecord } from "./decision-log";

export { createInMemoryKillSwitch, engage, release, RELEASED } from "./kill-switch";
export type { KillSwitchState, KillSwitchStore } from "./kill-switch";

export { createInMemoryEquityStore, runCycle } from "./loop";
export type { CycleReport, EquityMemory, EquityStore, LoopContext, MarketFeed } from "./loop";

export { renderDashboard } from "./dashboard";
export type { DashboardModel } from "./dashboard";
