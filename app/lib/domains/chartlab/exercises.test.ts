import { beforeAll, describe, expect, it, vi } from "vitest";

// entitlements/index.ts (and, transitively, app/lib/db.ts's Prisma import
// chain) carries a "server-only" import — mocked the same way auth.test.ts
// does, so this file can run in Vitest's plain node environment.
vi.mock("server-only", () => ({}));

import { prisma } from "@/app/lib/db";
import { createChartExercise, submitChartAnswer, submitFollowUpResponse } from "./exercises";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";

// prisma/test.db (see prisma/test-db.ts) is dedicated entirely to Vitest —
// never shared with the real dev.db — so wiping these tables up front keeps
// repeated `npm test` runs idempotent instead of colliding on unique
// constraints (Student.email, Plan.name, Concept.slug).
beforeAll(async () => {
  // Scoped by this file's own "chartlab-test-" naming convention, not a bare
  // deleteMany() — Student/Plan/Concept are shared tables other domain test
  // files (journal.test.ts, lessons.test.ts) also write to, and Vitest runs
  // test files in parallel workers by default, so an unscoped wipe here is a
  // real race, not just a style preference.
  //
  // The Concept wipe used to read `contains: "-test"`, which this comment
  // described as scoped but which actually matched every other file's
  // fixtures too — `questions-test-concept-1` contains "-test". Because
  // ConceptMastery/ConceptMasteryEvent cascade from Concept, this worker could
  // delete another worker's mastery rows mid-test, and questions.test.ts duly
  // failed in CI with `expected undefined to be 'LEARNING'`. Keep every filter
  // here anchored to the "chartlab-test-" prefix, including this file's own
  // concept slugs, or the race comes back.
  await prisma.chartAnswer.deleteMany();
  await prisma.chartExercise.deleteMany();
  await prisma.student.deleteMany({ where: { email: { contains: "chartlab-test-" } } });
  await prisma.plan.deleteMany({ where: { name: { contains: "chartlab-test-" } } });
  await prisma.concept.deleteMany({ where: { slug: { contains: "chartlab-test-" } } });
});

describe("createChartExercise", () => {
  it("creates an exercise with no concepts", async () => {
    const exercise = await createChartExercise({
      title: "Break of structure",
      prompt: "What do you see?",
      imageDataUrl: "data:image/png;base64,AAA=",
    });
    expect(exercise.title).toBe("Break of structure");

    const stored = await prisma.chartExercise.findUnique({ where: { id: exercise.id }, include: { concepts: true } });
    expect(stored?.concepts).toEqual([]);
  });

  it("connects concepts when conceptIds is given", async () => {
    const concept = await prisma.concept.create({ data: { name: "Liquidity Sweep", slug: "chartlab-test-liquidity-sweep" } });
    const exercise = await createChartExercise({
      title: "Sweep exercise",
      prompt: "Mark the sweep",
      imageDataUrl: "data:image/png;base64,AAA=",
      conceptIds: [concept.id],
    });

    const stored = await prisma.chartExercise.findUnique({ where: { id: exercise.id }, include: { concepts: true } });
    expect(stored?.concepts.map((c) => c.id)).toEqual([concept.id]);
  });
});

describe("submitChartAnswer", () => {
  it("records an answer and generates a Socratic follow-up (mock provider)", async () => {
    const student = await prisma.student.create({
      data: { name: "Test Student", email: "chartlab-test-1@example.com", status: "ACTIVE" },
    });
    const exercise = await createChartExercise({
      title: "BOS exercise",
      prompt: "Where does structure break?",
      imageDataUrl: "data:image/png;base64,AAA=",
    });

    const answer = await submitChartAnswer({
      studentId: student.id,
      chartExerciseId: exercise.id,
      response: "Price sweeps the high then closes back below it.",
    });

    expect(answer).not.toBeNull();
    expect(answer!.response).toBe("Price sweeps the high then closes back below it.");
    expect(answer!.followUpQuestion).toBeTruthy(); // mock provider always returns a real question, never empty
  });

  it("returns null instead of throwing when chartExerciseId doesn't exist", async () => {
    const student = await prisma.student.create({
      data: { name: "Test Student 2", email: "chartlab-test-2@example.com", status: "ACTIVE" },
    });

    const result = await submitChartAnswer({
      studentId: student.id,
      chartExerciseId: "does-not-exist",
      response: "This should not be persisted.",
    });

    expect(result).toBeNull();
    const rows = await prisma.chartAnswer.findMany({ where: { studentId: student.id } });
    expect(rows).toHaveLength(0);
  });
});

describe("submitFollowUpResponse", () => {
  it("lets a student record a reply to their own follow-up", async () => {
    const student = await prisma.student.create({
      data: { name: "Test Student 3", email: "chartlab-test-3@example.com", status: "ACTIVE" },
    });
    const exercise = await createChartExercise({
      title: "Reply exercise",
      prompt: "What do you see?",
      imageDataUrl: "data:image/png;base64,AAA=",
    });
    const answer = await submitChartAnswer({ studentId: student.id, chartExerciseId: exercise.id, response: "..." });

    await submitFollowUpResponse({ studentId: student.id, chartAnswerId: answer!.id, response: "My reply." });

    const updated = await prisma.chartAnswer.findUnique({ where: { id: answer!.id } });
    expect(updated?.followUpResponse).toBe("My reply.");
  });

  it("does not let a different student overwrite someone else's answer", async () => {
    const owner = await prisma.student.create({
      data: { name: "Owner", email: "chartlab-test-owner@example.com", status: "ACTIVE" },
    });
    const attacker = await prisma.student.create({
      data: { name: "Attacker", email: "chartlab-test-attacker@example.com", status: "ACTIVE" },
    });
    const exercise = await createChartExercise({
      title: "Isolation exercise",
      prompt: "What do you see?",
      imageDataUrl: "data:image/png;base64,AAA=",
    });
    const answer = await submitChartAnswer({ studentId: owner.id, chartExerciseId: exercise.id, response: "..." });

    const result = await submitFollowUpResponse({
      studentId: attacker.id,
      chartAnswerId: answer!.id,
      response: "Hijacked reply.",
    });

    expect(result.count).toBe(0); // updateMany's where clause matched nothing
    const untouched = await prisma.chartAnswer.findUnique({ where: { id: answer!.id } });
    expect(untouched?.followUpResponse).toBeNull();
  });
});

describe("USE_CHART_LAB entitlement (the check submitChartAnswerAction gates on)", () => {
  it("is false for a student on a plan without the capability", async () => {
    const plan = await prisma.plan.create({ data: { name: "chartlab-test-free", capabilities: "USE_AI_TUTOR" } });
    const student = await prisma.student.create({
      data: { name: "No Chart Lab", email: "chartlab-test-noaccess@example.com", status: "ACTIVE", planId: plan.id },
    });

    expect(await studentCan(student.id, CAPABILITIES.USE_CHART_LAB)).toBe(false);
  });

  it("is true for a student on a plan with the capability", async () => {
    const plan = await prisma.plan.create({
      data: { name: "chartlab-test-plan", capabilities: "USE_AI_TUTOR,USE_CHART_LAB" },
    });
    const student = await prisma.student.create({
      data: { name: "Has Chart Lab", email: "chartlab-test-access@example.com", status: "ACTIVE", planId: plan.id },
    });

    expect(await studentCan(student.id, CAPABILITIES.USE_CHART_LAB)).toBe(true);
  });

  it("is false for a student with no plan assigned at all", async () => {
    const student = await prisma.student.create({
      data: { name: "No Plan", email: "chartlab-test-noplan@example.com", status: "ACTIVE" },
    });

    expect(await studentCan(student.id, CAPABILITIES.USE_CHART_LAB)).toBe(false);
  });
});
