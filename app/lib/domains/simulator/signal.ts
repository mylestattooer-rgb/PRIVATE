// The AI boundary. Everything an LLM is allowed to contribute to a trade enters
// through this file and nowhere else.
//
// AI_ARCHITECTURE.md treats the AI as an untrusted subsystem, so model output is
// parsed here the same way any other untrusted input would be — schema-checked,
// range-checked, and stripped of fields it has no business setting:
//
//   * `source` is assigned by the caller, never read from the payload. A model
//     cannot launder its own suggestion into a rule-derived one.
//   * `symbol` is pinned to the symbol the caller asked about. A model that
//     replies about a different ticker (a classic injection result when it has
//     been fed news text) is rejected, not followed.
//   * `rationale` is bounded and is *data* — it is logged and shown to a human,
//     never concatenated into a later prompt as instructions.
//
// A Signal still cannot move money on its own: it has no quantity field. Only
// risk.ts can turn one into an Order.

import { z } from "zod";
import type { Signal, SignalAction, SignalSource } from "./types";

export const SIGNAL_ACTIONS: readonly SignalAction[] = ["enter_long", "enter_short", "exit", "hold"];

/** Long enough for a real explanation, short enough that a runaway or
 *  adversarial model cannot flood the audit log. */
export const MAX_RATIONALE_LENGTH = 1000;

const finitePositive = z
  .number()
  .refine((n) => Number.isFinite(n) && n > 0, { message: "must be a finite number greater than 0" });

const signalPayloadSchema = z.object({
  action: z.enum(["enter_long", "enter_short", "exit", "hold"]),
  confidence: z
    .number()
    .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1, { message: "must be between 0 and 1" }),
  stopPrice: finitePositive.nullable().default(null),
  targetPrice: finitePositive.nullable().default(null),
  rationale: z.string().max(MAX_RATIONALE_LENGTH).default(""),
});

export type SignalParseResult = { ok: true; signal: Signal } | { ok: false; errors: string[] };

export function isEntryAction(action: SignalAction): boolean {
  return action === "enter_long" || action === "enter_short";
}

/** The safe default. Used whenever a strategy has nothing to say, and whenever
 *  an AI response fails to parse — a broken model response must degrade to
 *  inaction, never to a guess. */
export function holdSignal(symbol: string, rationale: string, source: SignalSource = "rule"): Signal {
  return {
    symbol,
    action: "hold",
    confidence: 0,
    stopPrice: null,
    targetPrice: null,
    rationale: rationale.slice(0, MAX_RATIONALE_LENGTH),
    source,
  };
}

/** Models routinely wrap JSON in prose or a ``` fence. Pull the first JSON
 *  object out rather than failing on formatting alone. */
function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

/**
 * Parse untrusted signal output (typically an LLM response) for `symbol`.
 *
 * `source` defaults to "ai" because that is what this function exists for;
 * pass "rule" only when replaying a recorded deterministic signal.
 */
export function parseSignal(input: unknown, symbol: string, source: SignalSource = "ai"): SignalParseResult {
  let candidate: unknown = input;

  if (typeof input === "string") {
    const json = extractJsonObject(input);
    if (json === null) return { ok: false, errors: ["response contained no JSON object"] };
    try {
      candidate = JSON.parse(json);
    } catch {
      return { ok: false, errors: ["response was not valid JSON"] };
    }
  }

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, errors: ["signal must be an object"] };
  }

  // Checked before schema parsing so a mismatched ticker is reported as the
  // specific problem it is, rather than buried among field errors.
  const claimedSymbol = (candidate as { symbol?: unknown }).symbol;
  if (typeof claimedSymbol === "string" && claimedSymbol.toUpperCase() !== symbol.toUpperCase()) {
    return { ok: false, errors: [`signal is for ${claimedSymbol}, expected ${symbol}`] };
  }

  const parsed = signalPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const { action, confidence, stopPrice, targetPrice, rationale } = parsed.data;

  // An entry without a stop has no definable risk, so risk.ts could not size it.
  // Reject here so the failure names the real cause.
  if (isEntryAction(action) && stopPrice === null) {
    return { ok: false, errors: [`${action} requires a stopPrice`] };
  }

  return {
    ok: true,
    signal: { symbol: symbol.toUpperCase(), action, confidence, stopPrice, targetPrice, rationale, source },
  };
}
