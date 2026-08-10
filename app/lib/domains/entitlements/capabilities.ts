// Capability constants — the vocabulary entitlement checks and Plan.capabilities
// strings share. Adding a capability is a code change (new call sites need to
// know it exists); granting it to a plan is a data change only. See
// ARCHITECTURE.md "Decision: entitlements as one central module, from day one".

export const CAPABILITIES = {
  USE_AI_TUTOR: "USE_AI_TUTOR",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];
