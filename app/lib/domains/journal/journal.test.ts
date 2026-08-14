import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/app/lib/db";
import { createTrade, deleteTrade, generateInsight } from "./journal";
import { MIN_TRADES_FOR_INSIGHT } from "./insights";

// prisma/test.db is dedicated to Vitest (see prisma/test-db.ts) — wiping
// these tables up front keeps repeated `npm test` runs idempotent instead of
// colliding on Student.email's unique constraint.
beforeAll(async () => {
  await prisma.aiInsight.deleteMany();
  await prisma.journalTrade.deleteMany();
  await prisma.student.deleteMany({ where: { email: { contains: "journal-test-" } } });
});

async function makeStudent(email: string) {
  return prisma.student.create({ data: { name: "Journal Test Student", email, status: "ACTIVE" } });
}

describe("createTrade / deleteTrade", () => {
  it("creates a trade owned by the given student", async () => {
    const student = await makeStudent("journal-test-create@example.com");
    const trade = await createTrade({
      studentId: student.id,
      symbol: "XAUUSD",
      direction: "long",
      result: "win",
      rMultiple: 2,
      tradedAt: new Date("2026-08-01"),
    });
    expect(trade.studentId).toBe(student.id);
    expect(trade.symbol).toBe("XAUUSD");
  });

  it("only deletes a trade if it belongs to the requesting student", async () => {
    const owner = await makeStudent("journal-test-owner@example.com");
    const attacker = await makeStudent("journal-test-attacker@example.com");
    const trade = await createTrade({
      studentId: owner.id,
      symbol: "XAUUSD",
      direction: "short",
      result: "loss",
      tradedAt: new Date("2026-08-02"),
    });

    const attackerResult = await deleteTrade(attacker.id, trade.id);
    expect(attackerResult.count).toBe(0);
    expect(await prisma.journalTrade.findUnique({ where: { id: trade.id } })).not.toBeNull();

    const ownerResult = await deleteTrade(owner.id, trade.id);
    expect(ownerResult.count).toBe(1);
    expect(await prisma.journalTrade.findUnique({ where: { id: trade.id } })).toBeNull();
  });
});

describe("generateInsight", () => {
  it("returns null below the minimum trade count, and writes nothing", async () => {
    const student = await makeStudent("journal-test-toofew@example.com");
    for (let i = 0; i < MIN_TRADES_FOR_INSIGHT - 1; i++) {
      await createTrade({
        studentId: student.id,
        symbol: "XAUUSD",
        direction: "long",
        result: "win",
        rMultiple: 1,
        tradedAt: new Date(2026, 7, i + 1),
      });
    }

    const insight = await generateInsight(student.id);
    expect(insight).toBeNull();
    expect(await prisma.aiInsight.count({ where: { studentId: student.id } })).toBe(0);
  });

  it("generates an evidence-linked insight once the minimum is met", async () => {
    const student = await makeStudent("journal-test-enough@example.com");
    const trades = [];
    for (let i = 0; i < MIN_TRADES_FOR_INSIGHT; i++) {
      trades.push(
        await createTrade({
          studentId: student.id,
          symbol: "XAUUSD",
          direction: "long",
          result: "win",
          rMultiple: 1.5,
          setupTag: "displacement+FVG",
          tradedAt: new Date(2026, 7, i + 1),
        })
      );
    }

    const insight = await generateInsight(student.id);
    expect(insight).not.toBeNull();
    expect(insight!.summary).toContain("displacement+FVG");

    // Evidence-linked, not a floating claim: the insight's m2m must point at
    // exactly the trades it was computed from (DATABASE.md §2.4).
    const stored = await prisma.aiInsight.findUnique({ where: { id: insight!.id }, include: { trades: true } });
    expect(stored?.trades.map((t) => t.id).sort()).toEqual(trades.map((t) => t.id).sort());
  });
});
