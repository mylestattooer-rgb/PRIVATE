import { describe, expect, it } from "vitest";
import * as riskControl from "./index";
import { CONSERVATIVE_POLICY, freezePolicy, type RiskPolicy } from "./policy";
import { preflight, type ProposedOrder, type RiskSnapshot } from "./preflight";

const NOW = "2026-09-16T12:00:00.000Z";

const order = (overrides: Partial<ProposedOrder> = {}): ProposedOrder => ({
  symbol: "EURUSD",
  side: "buy",
  quantity: 1,
  intent: "open",
  price: 1_000,
  ...overrides,
});

/** A snapshot in which every single check passes. Each test violates one thing. */
const snapshot = (overrides: Partial<RiskSnapshot> = {}): RiskSnapshot => ({
  at: NOW,
  equity: 10_000,
  dayStartEquity: 10_000,
  peakEquity: 10_000,
  positions: [],
  quote: { symbol: "EURUSD", bid: 999.9, ask: 1_000.1, at: "2026-09-16T11:59:50.000Z" },
  recentOrderTimes: [],
  halts: [],
  ...overrides,
});

const policy = (overrides: Partial<RiskPolicy> = {}): RiskPolicy => ({ ...CONSERVATIVE_POLICY, ...overrides });

const failed = (verdict: ReturnType<typeof preflight>) => verdict.violations.map((v) => v.code);

describe("baseline", () => {
  it("allows an order that satisfies every limit", () => {
    const verdict = preflight(order(), snapshot(), policy());
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it("records every check that ran, not just the failures", () => {
    const verdict = preflight(order(), snapshot(), policy());
    // The decision log in step 5 is only useful if passes are recorded too.
    expect(verdict.checks.length).toBeGreaterThanOrEqual(12);
    expect(verdict.checks.every((c) => c.passed)).toBe(true);
  });

  it("is pure — repeated evaluation gives an identical verdict and mutates nothing", () => {
    const snap = snapshot();
    const frozen = JSON.stringify(snap);
    const a = preflight(order(), snap, policy());
    const b = preflight(order(), snap, policy());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(snap)).toBe(frozen);
  });
});

describe("closing orders", () => {
  it("is always allowed, even with every other limit breached", () => {
    const verdict = preflight(
      order({ intent: "close", quantity: 99 }),
      snapshot({
        equity: 100,
        dayStartEquity: 10_000,
        peakEquity: 50_000,
        quote: null,
        halts: [{ reason: "manual_kill_switch", detail: "operator halted" }],
        recentOrderTimes: [NOW],
      }),
      policy(),
    );
    // A gate that can trap you in a losing position is worse than no gate.
    expect(verdict.allowed).toBe(true);
  });
});

describe("fails closed", () => {
  it("denies a non-finite quantity or price", () => {
    expect(preflight(order({ quantity: Number.NaN }), snapshot(), policy()).allowed).toBe(false);
    expect(preflight(order({ price: Number.POSITIVE_INFINITY }), snapshot(), policy()).allowed).toBe(false);
  });

  it("denies a non-positive quantity or price", () => {
    expect(failed(preflight(order({ quantity: 0 }), snapshot(), policy()))).toContain("invalid_input");
    expect(failed(preflight(order({ price: -1 }), snapshot(), policy()))).toContain("invalid_input");
  });

  it("denies when equity is zero or negative, since no percentage limit means anything", () => {
    expect(failed(preflight(order(), snapshot({ equity: 0 }), policy()))).toContain("invalid_input");
  });

  it("denies when there is no quote, and says so on every quote-dependent check", () => {
    const verdict = preflight(order(), snapshot({ quote: null }), policy());
    expect(verdict.allowed).toBe(false);
    expect(failed(verdict)).toEqual(expect.arrayContaining(["missing_quote", "stale_quote", "spread_too_wide"]));
  });

  it("denies on a malformed quote with the ask below the bid", () => {
    const verdict = preflight(
      order(),
      snapshot({ quote: { symbol: "EURUSD", bid: 1_001, ask: 999, at: "2026-09-16T11:59:50.000Z" } }),
      policy(),
    );
    expect(failed(verdict)).toContain("spread_too_wide");
  });

  it("denies on an unparseable quote timestamp", () => {
    const verdict = preflight(
      order(),
      snapshot({ quote: { symbol: "EURUSD", bid: 999.9, ask: 1_000.1, at: "whenever" } }),
      policy(),
    );
    expect(failed(verdict)).toContain("stale_quote");
  });
});

describe("standing halts", () => {
  it("blocks new entries while any halt is active", () => {
    const verdict = preflight(
      order(),
      snapshot({ halts: [{ reason: "reconciliation_discrepancy", detail: "broker holds 2 EURUSD" }] }),
      policy(),
    );
    expect(verdict.allowed).toBe(false);
    expect(failed(verdict)).toContain("halt_active");
    expect(verdict.violations.find((v) => v.code === "halt_active")!.detail).toContain("broker holds 2");
  });
});

describe("market quality", () => {
  it("blocks a stale quote", () => {
    const verdict = preflight(
      order(),
      snapshot({ quote: { symbol: "EURUSD", bid: 999.9, ask: 1_000.1, at: "2026-09-16T11:50:00.000Z" } }),
      policy({ maxQuoteAgeSeconds: 120 }),
    );
    expect(failed(verdict)).toContain("stale_quote");
    expect(verdict.violations.find((v) => v.code === "stale_quote")!.observed).toBe(600);
  });

  it("blocks a spread wider than the limit", () => {
    const verdict = preflight(
      order(),
      snapshot({ quote: { symbol: "EURUSD", bid: 998, ask: 1_002, at: "2026-09-16T11:59:50.000Z" } }),
      policy({ maxSpreadPct: 0.05 }),
    );
    expect(failed(verdict)).toContain("spread_too_wide");
    expect(verdict.violations.find((v) => v.code === "spread_too_wide")!.observed).toBeCloseTo(0.4, 6);
  });

  it("allows a spread exactly at the limit", () => {
    const verdict = preflight(
      order(),
      snapshot({ quote: { symbol: "EURUSD", bid: 999.75, ask: 1_000.25, at: "2026-09-16T11:59:50.000Z" } }),
      policy({ maxSpreadPct: 0.05 }),
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe("size and exposure", () => {
  it("blocks more units than the hard cap", () => {
    expect(failed(preflight(order({ quantity: 2 }), snapshot(), policy({ maxPositionUnits: 1 })))).toContain(
      "position_units_exceeded",
    );
  });

  it("blocks a position larger than the per-position notional limit", () => {
    const verdict = preflight(order({ price: 3_000 }), snapshot(), policy({ maxPositionNotionalPct: 20 }));
    expect(failed(verdict)).toContain("position_notional_exceeded");
    expect(verdict.violations.find((v) => v.code === "position_notional_exceeded")!.observed).toBe(30);
  });

  it("counts existing positions toward total exposure", () => {
    const verdict = preflight(
      order(),
      snapshot({ positions: [{ symbol: "GBPUSD", quantity: 1, notional: 3_500 }] }),
      policy({ maxTotalNotionalPct: 40 }),
    );
    expect(failed(verdict)).toContain("total_exposure_exceeded");
    expect(verdict.violations.find((v) => v.code === "total_exposure_exceeded")!.observed).toBe(45);
  });

  it("blocks on leverage even when the percentage limits are raised", () => {
    const verdict = preflight(
      order({ quantity: 1, price: 25_000 }),
      snapshot(),
      policy({ maxPositionUnits: 5, maxPositionNotionalPct: 1_000, maxTotalNotionalPct: 1_000, maxLeverage: 2 }),
    );
    expect(failed(verdict)).toContain("leverage_exceeded");
    expect(verdict.violations.find((v) => v.code === "leverage_exceeded")!.observed).toBe(2.5);
  });

  it("blocks opening one position too many", () => {
    const verdict = preflight(
      order({ symbol: "USDJPY" }),
      snapshot({
        positions: [
          { symbol: "GBPUSD", quantity: 1, notional: 100 },
          { symbol: "AUDUSD", quantity: 1, notional: 100 },
        ],
      }),
      policy({ maxOpenPositions: 2 }),
    );
    expect(failed(verdict)).toContain("max_open_positions");
  });

  it("does not count a symbol already held as a new position slot", () => {
    const verdict = preflight(
      order({ symbol: "GBPUSD" }),
      snapshot({
        positions: [
          { symbol: "GBPUSD", quantity: 1, notional: 100 },
          { symbol: "AUDUSD", quantity: 1, notional: 100 },
        ],
      }),
      policy({ maxOpenPositions: 2 }),
    );
    expect(failed(verdict)).not.toContain("max_open_positions");
  });
});

describe("loss control", () => {
  it("blocks at the daily loss limit and allows just under it", () => {
    expect(failed(preflight(order(), snapshot({ equity: 9_800 }), policy({ maxDailyLossPct: 2 })))).toContain(
      "daily_loss_limit",
    );
    expect(failed(preflight(order(), snapshot({ equity: 9_810 }), policy({ maxDailyLossPct: 2 })))).not.toContain(
      "daily_loss_limit",
    );
  });

  it("blocks at the peak-to-trough drawdown limit", () => {
    const verdict = preflight(
      order(),
      snapshot({ equity: 9_000, dayStartEquity: 9_000, peakEquity: 10_000 }),
      policy({ maxDrawdownPct: 10 }),
    );
    expect(failed(verdict)).toContain("drawdown_limit");
  });

  it("measures drawdown from the all-time peak, not from today's open", () => {
    // Flat on the day, but well below the peak — the daily limit would miss this.
    const verdict = preflight(
      order(),
      snapshot({ equity: 8_000, dayStartEquity: 8_000, peakEquity: 10_000 }),
      policy({ maxDailyLossPct: 2, maxDrawdownPct: 10 }),
    );
    expect(failed(verdict)).toContain("drawdown_limit");
    expect(failed(verdict)).not.toContain("daily_loss_limit");
  });
});

describe("throttle", () => {
  it("blocks once the hourly order count reaches the limit", () => {
    const times = Array.from({ length: 6 }, (_, i) => new Date(Date.parse(NOW) - (i + 1) * 300_000).toISOString());
    const verdict = preflight(order(), snapshot({ recentOrderTimes: times }), policy({ maxOrdersPerHour: 6 }));
    expect(failed(verdict)).toContain("order_rate_limit");
  });

  it("ignores orders older than an hour", () => {
    const times = Array.from({ length: 6 }, (_, i) => new Date(Date.parse(NOW) - 3_700_000 - i * 1_000).toISOString());
    const verdict = preflight(order(), snapshot({ recentOrderTimes: times }), policy({ maxOrdersPerHour: 6 }));
    expect(failed(verdict)).not.toContain("order_rate_limit");
  });

  it("enforces a cooldown between consecutive orders", () => {
    const verdict = preflight(
      order(),
      snapshot({ recentOrderTimes: ["2026-09-16T11:59:30.000Z"] }),
      policy({ minSecondsBetweenOrders: 60 }),
    );
    expect(failed(verdict)).toContain("order_cooldown");
    expect(verdict.violations.find((v) => v.code === "order_cooldown")!.observed).toBe(30);
  });

  it("does not apply a cooldown when nothing has been ordered yet", () => {
    expect(failed(preflight(order(), snapshot({ recentOrderTimes: [] }), policy()))).not.toContain("order_cooldown");
  });
});

describe("reporting", () => {
  it("reports every violation rather than stopping at the first", () => {
    const verdict = preflight(
      order({ quantity: 50, price: 5_000 }),
      snapshot({
        equity: 9_000,
        dayStartEquity: 10_000,
        peakEquity: 20_000,
        quote: { symbol: "EURUSD", bid: 900, ask: 1_100, at: "2026-09-16T10:00:00.000Z" },
        recentOrderTimes: [NOW],
        halts: [{ reason: "connectivity", detail: "feed down" }],
      }),
      policy(),
    );

    expect(verdict.allowed).toBe(false);
    expect(failed(verdict)).toEqual(
      expect.arrayContaining([
        "halt_active",
        "stale_quote",
        "spread_too_wide",
        "position_units_exceeded",
        "position_notional_exceeded",
        "total_exposure_exceeded",
        "leverage_exceeded",
        "daily_loss_limit",
        "drawdown_limit",
        "order_cooldown",
      ]),
    );
  });

  it("carries the observed value and the limit on every check, for the dashboard", () => {
    const verdict = preflight(order(), snapshot(), policy());
    const leverage = verdict.checks.find((c) => c.code === "leverage_exceeded")!;
    expect(leverage.observed).toBeCloseTo(0.1, 6);
    expect(leverage.limit).toBe(CONSERVATIVE_POLICY.maxLeverage);
  });
});

describe("policy immutability", () => {
  it("cannot be mutated once frozen", () => {
    const frozen = freezePolicy(CONSERVATIVE_POLICY);
    expect(() => {
      (frozen as RiskPolicy).maxLeverage = 100;
    }).toThrow();
    expect(frozen.maxLeverage).toBe(CONSERVATIVE_POLICY.maxLeverage);
  });

  it("exposes no way to widen a limit from the signal path", () => {
    // Asserted against the domain's real export surface, so adding a setter
    // later fails this test rather than quietly widening the boundary.
    const surface = Object.keys(riskControl);
    expect(surface.filter((key) => /set|update|override|relax|widen|disable/i.test(key))).toEqual([]);
    expect(surface).toContain("preflight");
  });
});
