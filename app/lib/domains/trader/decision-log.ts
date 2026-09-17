// Append-only record of every decision the system makes, and why.
//
// The requirement this serves: any decision must be replayable. That means
// recording the INPUTS a decision was made from, not just the conclusion — a
// log saying "did not trade" is useless a week later; one saying "did not
// trade: spread was 0.31% against a 0.05% limit, quote at 09:14:02" is a
// diagnosis.
//
// Where a signal came from an AI, the raw prompt and the raw response are
// recorded verbatim. That is the only way to tell later whether a bad trade came
// from a bad model output or from correct handling of a reasonable one. Those
// fields are DATA: they are written, displayed, and replayed, and never fed back
// into a later prompt as instructions.

export type DecisionPhase =
  | "cycle_start"
  | "kill_switch"
  | "reconcile"
  | "market_data"
  | "signal"
  | "preflight"
  | "submit"
  | "cycle_end";

export type DecisionRecord = {
  /** Monotonic within a log, so records sort stably even at equal timestamps. */
  seq: number;
  at: string;
  cycleId: string;
  phase: DecisionPhase;
  symbol: string | null;
  /** Did this phase permit the cycle to continue toward placing an order? */
  proceeded: boolean;
  /** One line, human first. This is what shows on the dashboard. */
  summary: string;
  /** Everything needed to re-derive the conclusion. */
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** Present only when an AI produced the signal. Verbatim, untrusted, never
   *  re-injected into a prompt. */
  ai: { model: string; prompt: string; response: string } | null;
};

export type DecisionLog = {
  append(record: Omit<DecisionRecord, "seq">): Promise<DecisionRecord>;
  all(): Promise<DecisionRecord[]>;
  forCycle(cycleId: string): Promise<DecisionRecord[]>;
  /** Most recent first — what a dashboard renders. */
  recent(limit: number): Promise<DecisionRecord[]>;
};

export function createInMemoryDecisionLog(): DecisionLog {
  const records: DecisionRecord[] = [];

  return {
    async append(record) {
      const stored: DecisionRecord = { ...record, seq: records.length + 1 };
      records.push(stored);
      return stored;
    },
    async all() {
      return [...records];
    },
    async forCycle(cycleId) {
      return records.filter((r) => r.cycleId === cycleId);
    },
    async recent(limit) {
      // slice(-0) is slice(0) and returns the whole log.
      if (limit <= 0) return [];
      return records.slice(-limit).reverse();
    },
  };
}

/** Render a log as plain text. Used by the dashboard and by the operator
 *  reading back what happened overnight. */
export function formatDecisions(records: DecisionRecord[]): string {
  return records
    .map((r) => {
      const mark = r.proceeded ? "·" : "✕";
      return `${r.at}  ${mark} ${r.phase.padEnd(13)} ${r.symbol ?? "-"}  ${r.summary}`;
    })
    .join("\n");
}
