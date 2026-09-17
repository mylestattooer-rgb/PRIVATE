// Alerting: telling a person the things a person has to act on.
//
// The decision log already records everything that happens, and a dashboard
// shows the current state to whoever is looking. Neither helps at three in the
// morning, which is the only time an unattended system's alerting matters.
//
// **The hard part is not sending alerts, it is not sending them.** A system
// that halts itself at 02:00 and runs a cycle a minute would send 480 alerts
// before anyone woke up. Nobody reads the 480th; in practice they mute the
// channel, and the mute outlives the incident. So alerting here fires on
// TRANSITIONS — when a condition appears, and again when it clears — never on
// the continued existence of a condition already reported.
//
// **Recovery is alerted too.** An operator told that something broke and never
// told it healed has to go and look, which is the behaviour alerting exists to
// remove. A cleared alert is as much a call to stop worrying as the original
// was a call to start.

import type { CycleReport } from "./loop";

export type AlertSeverity =
  /** Trading has stopped and will not restart without a person. */
  | "critical"
  /** Trading has stopped but the system expects to recover by itself. */
  | "warning"
  /** A previously reported condition has cleared. */
  | "recovery";

export type Alert = {
  /**
   * Stable identity of the CONDITION, not of the occurrence. Two cycles
   * reporting the same problem produce the same key, which is what lets
   * `diffAlerts` tell "still broken" from "newly broken".
   */
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  at: string;
};

export type Notifier = {
  send(alert: Alert): Promise<void>;
};

/**
 * Halt reasons that need a person, as opposed to those the system clears on
 * its own next cycle.
 *
 * `stale_data` and `connectivity` are deliberately absent: a single missed
 * quote is not an incident, and treating it as one is how the channel gets
 * muted before a real incident arrives. They become critical only by way of
 * the kill switch, which latches.
 */
const NEEDS_A_PERSON = new Set([
  "manual_kill_switch",
  "reconciliation_discrepancy",
  "unresolved_order",
  "risk_limit",
]);

/**
 * The conditions a cycle is currently reporting, as alerts.
 *
 * Pure: it describes the present, and says nothing about what was sent before.
 * Deciding what to actually send is `diffAlerts`, so that the "what is true"
 * and "what is new" questions stay separable and separately testable.
 */
export function alertsForCycle(report: CycleReport): Alert[] {
  const alerts: Alert[] = [];

  if (report.selfHalted !== null) {
    alerts.push({
      key: "kill_switch",
      severity: "critical",
      title: "Trading stopped — the system halted itself",
      detail: `${report.selfHalted}. It will not resume until someone releases the kill switch.`,
      at: report.at,
    });
  }

  for (const halt of report.halts) {
    if (!NEEDS_A_PERSON.has(halt.reason)) continue;
    // The kill switch already spoke for itself above.
    if (halt.reason === "manual_kill_switch" && report.selfHalted !== null) continue;
    alerts.push({
      key: `halt:${halt.reason}`,
      severity: "critical",
      title: `Not opening new positions — ${halt.reason}`,
      detail: halt.detail,
      at: report.at,
    });
  }

  return alerts;
}

/**
 * What to send, given what is true now and what was already reported.
 *
 * Returns new conditions plus recovery notices for conditions that have
 * cleared, and the key set to carry into the next cycle. Nothing is sent for a
 * condition that was already reported and still holds.
 *
 * `at` is passed rather than read from a clock, so a cycle can be replayed and
 * produce byte-identical alerts — the same rule the rest of this system runs
 * under.
 *
 * The caller persists `keys` alongside its other durable state. Losing it
 * across a restart re-sends open alerts once, which is the right way to fail:
 * a duplicate alert is an annoyance and a missed one is an outage nobody knows
 * about.
 */
export function diffAlerts(
  current: Alert[],
  previousKeys: readonly string[],
  at: string,
): { send: Alert[]; keys: string[] } {
  const currentKeys = new Set(current.map((a) => a.key));
  const previous = new Set(previousKeys);

  const send = current.filter((a) => !previous.has(a.key));

  for (const key of previous) {
    if (currentKeys.has(key)) continue;
    send.push({
      key,
      severity: "recovery",
      title: `Cleared — ${key}`,
      detail: "The condition previously reported is no longer present.",
      // Injected, not scavenged from `current`. A recovery notice is emitted
      // exactly when `current` is empty, so reading the time off the first
      // current alert stamped every all-clear with the epoch.
      at,
    });
  }

  return { send, keys: [...currentKeys].sort() };
}

/** Collects alerts in memory. For tests, and for asserting what WOULD be sent. */
export function createInMemoryNotifier(): Notifier & { sent: Alert[] } {
  const sent: Alert[] = [];
  return {
    sent,
    async send(alert) {
      sent.push(alert);
    },
  };
}

/**
 * Writes to stderr, so alerts survive a redirected stdout and land where an
 * init system or container runtime will pick them up.
 *
 * A real deployment swaps this for email, SMS or a pager. The port is one
 * method wide on purpose: anything that can receive a string can implement it,
 * and nothing in the trading path should ever depend on which.
 */
export function createConsoleNotifier(write: (line: string) => void = console.error): Notifier {
  const mark: Record<AlertSeverity, string> = {
    critical: "CRITICAL",
    warning: "WARNING ",
    recovery: "CLEARED ",
  };
  return {
    async send(alert) {
      write(`[${alert.at}] ${mark[alert.severity]}  ${alert.title}\n            ${alert.detail}`);
    },
  };
}

/**
 * A notifier that never throws into the trading loop.
 *
 * An alerting outage must not become a trading outage. If the pager is down,
 * that is bad; if the pager being down also stops the system closing a losing
 * position, that is a different order of bad. Failures are surfaced through
 * `onError` and swallowed.
 */
export function neverThrows(inner: Notifier, onError: (error: unknown) => void = () => {}): Notifier {
  return {
    async send(alert) {
      try {
        await inner.send(alert);
      } catch (error) {
        onError(error);
      }
    },
  };
}
