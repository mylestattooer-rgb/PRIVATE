// Public surface of the risk-control domain.
//
// Note what is absent: there is no setter, updater, override, or escape hatch
// for a limit anywhere in this export list, and that absence is asserted by a
// test. A policy is constructed by the operator and passed in; the signal path
// can propose orders and be refused, and has no vocabulary for changing what a
// refusal means.

export { CONSERVATIVE_POLICY, freezePolicy } from "./policy";
export type { RiskPolicy } from "./policy";

export { preflight } from "./preflight";
export type {
  ActiveHalt,
  CheckResult,
  OpenPosition,
  ProposedOrder,
  Quote,
  RiskSnapshot,
  RiskVerdict,
  ViolationCode,
} from "./preflight";
