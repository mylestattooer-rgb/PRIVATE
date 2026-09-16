import { describe, expect, it } from "vitest";
import { createInMemoryDecisionLog, formatDecisions } from "./decision-log";

const entry = (cycleId: string, summary: string) => ({
  at: "2026-09-16T12:00:00.000Z",
  cycleId,
  phase: "signal" as const,
  symbol: "TEST",
  proceeded: true,
  summary,
  inputs: {},
  outputs: {},
  ai: null,
});

describe("createInMemoryDecisionLog", () => {
  it("numbers records monotonically so they sort stably at equal timestamps", async () => {
    const log = createInMemoryDecisionLog();
    await log.append(entry("c1", "first"));
    await log.append(entry("c1", "second"));
    expect((await log.all()).map((r) => r.seq)).toEqual([1, 2]);
  });

  it("filters by cycle", async () => {
    const log = createInMemoryDecisionLog();
    await log.append(entry("c1", "a"));
    await log.append(entry("c2", "b"));
    expect(await log.forCycle("c2")).toHaveLength(1);
  });

  it("returns the most recent first", async () => {
    const log = createInMemoryDecisionLog();
    await log.append(entry("c1", "older"));
    await log.append(entry("c1", "newer"));
    expect((await log.recent(1))[0].summary).toBe("newer");
  });

  it("returns nothing for a limit of zero, rather than the whole log", async () => {
    // slice(-0) is slice(0): the original returned every record.
    const log = createInMemoryDecisionLog();
    await log.append(entry("c1", "a"));
    await log.append(entry("c1", "b"));
    expect(await log.recent(0)).toEqual([]);
    expect(await log.recent(-5)).toEqual([]);
  });

  it("formats a readable line per decision, marking those that did not proceed", () => {
    const text = formatDecisions([
      { ...entry("c1", "went ahead"), seq: 1 },
      { ...entry("c1", "refused"), seq: 2, proceeded: false },
    ]);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("✕");
  });
});
