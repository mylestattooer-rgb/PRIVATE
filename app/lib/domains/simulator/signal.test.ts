import { describe, expect, it } from "vitest";
import { holdSignal, MAX_RATIONALE_LENGTH, parseSignal } from "./signal";

const valid = {
  symbol: "AAPL",
  action: "enter_long",
  confidence: 0.8,
  stopPrice: 95,
  targetPrice: 115,
  rationale: "reclaimed the range low",
};

describe("parseSignal", () => {
  it("accepts a well-formed signal and stamps the caller's provenance", () => {
    const result = parseSignal(valid, "AAPL");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal.action).toBe("enter_long");
    expect(result.signal.stopPrice).toBe(95);
    expect(result.signal.source).toBe("ai");
  });

  it("ignores a source claimed in the payload — a model cannot launder its own signal", () => {
    const result = parseSignal({ ...valid, source: "rule" }, "AAPL");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal.source).toBe("ai");
  });

  it("pins the symbol to the one requested and rejects a mismatch", () => {
    const result = parseSignal({ ...valid, symbol: "TSLA" }, "AAPL");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("expected AAPL");
  });

  it("extracts JSON from a fenced code block", () => {
    const raw = "Here is my view:\n```json\n" + JSON.stringify(valid) + "\n```\nHope that helps.";
    const result = parseSignal(raw, "AAPL");
    expect(result.ok).toBe(true);
  });

  it("extracts JSON from unfenced surrounding prose", () => {
    const result = parseSignal(`Sure! ${JSON.stringify(valid)} — let me know.`, "AAPL");
    expect(result.ok).toBe(true);
  });

  it("rejects a response with no JSON at all", () => {
    const result = parseSignal("I'm not able to give financial advice.", "AAPL");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(["response contained no JSON object"]);
  });

  it("rejects an entry with no stop, since risk.ts could not size it", () => {
    const result = parseSignal({ ...valid, stopPrice: null }, "AAPL");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("requires a stopPrice");
  });

  it("rejects confidence outside 0..1 rather than clamping it", () => {
    for (const confidence of [-0.1, 1.5, Number.NaN]) {
      expect(parseSignal({ ...valid, confidence }, "AAPL").ok).toBe(false);
    }
  });

  it("rejects an unknown action", () => {
    expect(parseSignal({ ...valid, action: "yolo" }, "AAPL").ok).toBe(false);
  });

  it("rejects a non-positive stop price", () => {
    expect(parseSignal({ ...valid, stopPrice: 0 }, "AAPL").ok).toBe(false);
    expect(parseSignal({ ...valid, stopPrice: -5 }, "AAPL").ok).toBe(false);
  });

  it("rejects an oversized rationale rather than truncating it", () => {
    const result = parseSignal({ ...valid, rationale: "x".repeat(MAX_RATIONALE_LENGTH + 1) }, "AAPL");
    expect(result.ok).toBe(false);
  });

  it("drops unknown fields a model invents", () => {
    const result = parseSignal({ ...valid, quantity: 500, leverage: 20 }, "AAPL");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signal).not.toHaveProperty("quantity");
    expect(result.signal).not.toHaveProperty("leverage");
  });

  it("allows an exit with no stop", () => {
    const result = parseSignal({ symbol: "AAPL", action: "exit", confidence: 0.9 }, "AAPL");
    expect(result.ok).toBe(true);
  });

  it("rejects arrays and primitives", () => {
    expect(parseSignal([valid], "AAPL").ok).toBe(false);
    expect(parseSignal(42, "AAPL").ok).toBe(false);
    expect(parseSignal(null, "AAPL").ok).toBe(false);
  });
});

describe("holdSignal", () => {
  it("is inert: no action, no confidence, no stop", () => {
    const signal = holdSignal("AAPL", "nothing to do");
    expect(signal.action).toBe("hold");
    expect(signal.confidence).toBe(0);
    expect(signal.stopPrice).toBeNull();
  });
});
