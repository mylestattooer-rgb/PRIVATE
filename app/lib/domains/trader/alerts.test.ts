import { describe, expect, it, vi } from "vitest";
import {
  alertsForCycle,
  createConsoleNotifier,
  createInMemoryNotifier,
  diffAlerts,
  neverThrows,
  type Alert,
} from "./alerts";
import type { CycleReport } from "./loop";

const AT = "2026-09-17T02:00:00.000Z";

const report = (overrides: Partial<CycleReport> = {}): CycleReport => ({
  cycleId: "c1",
  at: "2026-09-17T02:00:00.000Z",
  halts: [],
  decisions: [],
  orderSubmitted: false,
  clientOrderId: null,
  selfHalted: null,
  ...overrides,
});

describe("alertsForCycle", () => {
  it("says nothing about a healthy cycle", () => {
    expect(alertsForCycle(report())).toEqual([]);
  });

  it("raises a critical alert when the system halts itself", () => {
    const [alert] = alertsForCycle(report({ selfHalted: "order outcome unknown" }));
    expect(alert.severity).toBe("critical");
    expect(alert.key).toBe("kill_switch");
    // The operator's actual question is "will this fix itself?".
    expect(alert.detail).toContain("releases the kill switch");
  });

  it("raises alerts for halts that need a person", () => {
    const keys = alertsForCycle(
      report({
        halts: [
          { reason: "reconciliation_discrepancy", detail: "broker holds 5, we recorded 0" },
          { reason: "risk_limit", detail: "daily loss limit reached" },
        ],
      }),
    ).map((a) => a.key);
    expect(keys).toEqual(["halt:reconciliation_discrepancy", "halt:risk_limit"]);
  });

  it("stays quiet about halts the system clears by itself", () => {
    // A single missed quote is not an incident. Treating it as one is how the
    // channel gets muted before a real incident arrives.
    expect(
      alertsForCycle(
        report({
          halts: [
            { reason: "stale_data", detail: "quote is 40s old" },
            { reason: "connectivity", detail: "market data unavailable" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("does not report the kill switch twice in one cycle", () => {
    const alerts = alertsForCycle(
      report({
        selfHalted: "order outcome unknown",
        halts: [{ reason: "manual_kill_switch", detail: "engaged" }],
      }),
    );
    expect(alerts).toHaveLength(1);
  });

  it("still reports a pre-existing kill switch the cycle did not itself trip", () => {
    const alerts = alertsForCycle(
      report({ halts: [{ reason: "manual_kill_switch", detail: "engaged by operator" }] }),
    );
    expect(alerts.map((a) => a.key)).toEqual(["halt:manual_kill_switch"]);
  });
});

describe("diffAlerts", () => {
  const alert = (key: string): Alert => ({
    key,
    severity: "critical",
    title: "t",
    detail: "d",
    at: "2026-09-17T02:00:00.000Z",
  });

  it("sends a condition the first time it appears", () => {
    const { send, keys } = diffAlerts([alert("a")], [], AT);
    expect(send.map((a) => a.key)).toEqual(["a"]);
    expect(keys).toEqual(["a"]);
  });

  it("does NOT re-send a condition that is still true", () => {
    // The whole point. A cycle a minute for eight hours is 480 alerts, and
    // nobody reads the 480th — they mute the channel, and the mute outlives
    // the incident.
    const { send } = diffAlerts([alert("a")], ["a"], AT);
    expect(send).toEqual([]);
  });

  it("sends a recovery notice when a condition clears", () => {
    const { send, keys } = diffAlerts([], ["a"], AT);
    expect(send).toHaveLength(1);
    expect(send[0].severity).toBe("recovery");
    expect(send[0].key).toBe("a");
    expect(keys).toEqual([]);
  });

  it("handles one condition clearing while another appears", () => {
    const { send, keys } = diffAlerts([alert("b")], ["a"], AT);
    expect(send.filter((s) => s.severity === "critical").map((s) => s.key)).toEqual(["b"]);
    expect(send.filter((s) => s.severity === "recovery").map((s) => s.key)).toEqual(["a"]);
    expect(keys).toEqual(["b"]);
  });

  it("re-sends open alerts when prior state is lost, rather than staying silent", () => {
    // A duplicate alert is an annoyance; a missed one is an outage nobody knows
    // about. Losing the key set across a restart must fail toward the noise.
    const { send } = diffAlerts([alert("a")], [], AT);
    expect(send.map((a) => a.key)).toEqual(["a"]);
  });

  it("returns keys sorted, so the persisted value is stable", () => {
    expect(diffAlerts([alert("z"), alert("a")], [], AT).keys).toEqual(["a", "z"]);
  });

  it("stamps a recovery notice with the injected time, not the epoch", () => {
    // A recovery notice is emitted exactly when `current` is empty, so reading
    // the time off the first current alert stamped every all-clear 1970-01-01.
    // Caught by running the failure gauntlet and looking at the output.
    expect(diffAlerts([], ["a"], AT).send[0].at).toBe(AT);
  });
});

describe("notifiers", () => {
  it("collects in memory", async () => {
    const n = createInMemoryNotifier();
    await n.send({ key: "a", severity: "critical", title: "t", detail: "d", at: "x" });
    expect(n.sent).toHaveLength(1);
  });

  it("writes severity, title and detail to the console sink", async () => {
    const lines: string[] = [];
    await createConsoleNotifier((l) => lines.push(l)).send({
      key: "a",
      severity: "critical",
      title: "Trading stopped",
      detail: "because reasons",
      at: "2026-09-17T02:00:00.000Z",
    });
    expect(lines[0]).toContain("CRITICAL");
    expect(lines[0]).toContain("Trading stopped");
    expect(lines[0]).toContain("because reasons");
  });

  it("an alerting outage does not become a trading outage", async () => {
    // If the pager is down that is bad. If the pager being down also stops the
    // system closing a losing position, that is a different order of bad.
    const onError = vi.fn();
    const exploding = { send: async () => { throw new Error("pager is down"); } };
    await expect(neverThrows(exploding, onError).send({
      key: "a", severity: "critical", title: "t", detail: "d", at: "x",
    })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});
