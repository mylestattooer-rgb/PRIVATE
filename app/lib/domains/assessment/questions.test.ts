import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/app/lib/db";
import { createQuestion, gradeAttempt } from "./questions";
import { ACHIEVEMENT_KEYS } from "@/app/lib/domains/progression/achievements";

// prisma/test.db is dedicated to Vitest (see prisma/test-db.ts) — scoped
// deletes on the shared Module/Concept tables (this file's own
// "questions-test-" fixtures), full wipes on tables no other domain test
// file touches (Question/QuestionAttempt/XpEvent/UserAchievement/ConceptMastery).
beforeAll(async () => {
  await prisma.userAchievement.deleteMany();
  await prisma.conceptMasteryEvent.deleteMany();
  await prisma.conceptMastery.deleteMany();
  await prisma.xpEvent.deleteMany();
  await prisma.questionAttempt.deleteMany();
  await prisma.question.deleteMany();
  await prisma.lesson.deleteMany({ where: { slug: { contains: "questions-test-" } } });
  await prisma.module.deleteMany({ where: { slug: { contains: "questions-test-" } } });
  await prisma.concept.deleteMany({ where: { slug: { contains: "questions-test-" } } });
  await prisma.student.deleteMany({ where: { email: { contains: "questions-test-" } } });
  await prisma.achievement.upsert({
    where: { key: ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED },
    update: {},
    create: { key: ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED, name: "First Quiz Passed" },
  });
});

async function makeLesson(slug: string) {
  const mod = await prisma.module.create({ data: { title: "Test Module", slug: `questions-test-${slug}` } });
  const lesson = await prisma.lesson.create({
    data: { moduleId: mod.id, title: "Test Lesson", slug: `questions-test-${slug}` },
  });
  return lesson;
}

async function makeStudent(email: string) {
  return prisma.student.create({ data: { name: "Questions Test Student", email, status: "ACTIVE" } });
}

describe("createQuestion", () => {
  it("rejects a correctIndex outside the choices array", async () => {
    const lesson = await makeLesson("create-invalid");
    await expect(
      createQuestion({ lessonId: lesson.id, prompt: "?", choices: ["a", "b"], correctIndex: 2 })
    ).rejects.toThrow();
  });
});

describe("gradeAttempt", () => {
  it("awards XP, applies mastery evidence, and unlocks FIRST_QUIZ_PASSED on a first correct answer", async () => {
    const lesson = await makeLesson("first-correct");
    const concept = await prisma.concept.create({ data: { name: "Test Concept", slug: "questions-test-concept-1" } });
    const question = await createQuestion({
      lessonId: lesson.id,
      prompt: "2+2?",
      choices: ["3", "4"],
      correctIndex: 1,
      conceptIds: [concept.id],
    });
    const student = await makeStudent("questions-test-first-correct@example.com");

    const result = await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 1 });

    expect(result!.correct).toBe(true);
    expect(result!.xpAwarded).toBe(10);
    expect(result!.achievementUnlocked?.key).toBe(ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED);

    const xp = await prisma.xpEvent.findMany({ where: { studentId: student.id } });
    expect(xp).toHaveLength(1);
    expect(xp[0].amount).toBe(10);

    const mastery = await prisma.conceptMastery.findUnique({
      where: { studentId_conceptId: { studentId: student.id, conceptId: concept.id } },
    });
    expect(mastery?.state).toBe("LEARNING");
    expect(mastery?.consecutiveCorrect).toBe(1);
  });

  it("awards no XP on an incorrect answer, but still records the attempt and mastery evidence", async () => {
    const lesson = await makeLesson("incorrect");
    const concept = await prisma.concept.create({ data: { name: "Test Concept 2", slug: "questions-test-concept-2" } });
    const question = await createQuestion({
      lessonId: lesson.id,
      prompt: "2+2?",
      choices: ["3", "4"],
      correctIndex: 1,
      conceptIds: [concept.id],
    });
    const student = await makeStudent("questions-test-incorrect@example.com");

    const result = await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 0 });

    expect(result!.correct).toBe(false);
    expect(result!.xpAwarded).toBe(0);
    expect(result!.achievementUnlocked).toBeNull();
    expect(await prisma.xpEvent.count({ where: { studentId: student.id } })).toBe(0);
    expect(await prisma.questionAttempt.count({ where: { studentId: student.id } })).toBe(1);

    const mastery = await prisma.conceptMastery.findUnique({
      where: { studentId_conceptId: { studentId: student.id, conceptId: concept.id } },
    });
    // A wrong answer is still evidence the concept was attempted at least
    // once (CURRICULUM_SYSTEM.md's ladder) — streak just resets to 0.
    expect(mastery?.state).toBe("INTRODUCED");
    expect(mastery?.consecutiveCorrect).toBe(0);
  });

  it("does not re-unlock FIRST_QUIZ_PASSED on a second correct answer", async () => {
    const lesson = await makeLesson("second-correct");
    const question = await createQuestion({ lessonId: lesson.id, prompt: "?", choices: ["a", "b"], correctIndex: 0 });
    const student = await makeStudent("questions-test-second-correct@example.com");

    const first = await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 0 });
    expect(first!.achievementUnlocked?.key).toBe(ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED);

    const second = await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 0 });
    expect(second!.achievementUnlocked).toBeNull();

    expect(await prisma.userAchievement.count({ where: { studentId: student.id } })).toBe(1);
  });

  it("appends a mastery event per graded answer, preserving the path the snapshot overwrites", async () => {
    const lesson = await makeLesson("mastery-ledger");
    const concept = await prisma.concept.create({ data: { name: "Test Concept 3", slug: "questions-test-concept-3" } });
    const question = await createQuestion({
      lessonId: lesson.id,
      prompt: "2+2?",
      choices: ["3", "4"],
      correctIndex: 1,
      conceptIds: [concept.id],
    });
    const student = await makeStudent("questions-test-ledger@example.com");

    // right, right, wrong: climbs to UNDERSTOOD, then falls back. The
    // ConceptMastery row can only ever show the final state — the whole point
    // of the ledger is that the climb is still recoverable afterwards.
    await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 1 });
    await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 1 });
    await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 0 });

    const snapshot = await prisma.conceptMastery.findUnique({
      where: { studentId_conceptId: { studentId: student.id, conceptId: concept.id } },
    });
    expect(snapshot?.state).toBe("INTRODUCED");
    expect(snapshot?.consecutiveCorrect).toBe(0);

    const events = await prisma.conceptMasteryEvent.findMany({
      where: { studentId: student.id, conceptId: concept.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(3);
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([
      ["NOT_INTRODUCED", "LEARNING"],
      ["LEARNING", "UNDERSTOOD"],
      ["UNDERSTOOD", "INTRODUCED"],
    ]);
    expect(events.map((e) => e.toStreak)).toEqual([1, 2, 0]);
    expect(events.map((e) => e.correct)).toEqual([true, true, false]);

    // Each event points at the attempt that produced it — the evidence link
    // is what makes the ledger auditable rather than just a log.
    for (const e of events) {
      expect(e.attemptId).not.toBeNull();
      const attempt = await prisma.questionAttempt.findUnique({ where: { id: e.attemptId! } });
      expect(attempt?.studentId).toBe(student.id);
      expect(attempt?.correct).toBe(e.correct);
    }
  });

  it("writes no mastery event for a question that tests no concepts", async () => {
    const lesson = await makeLesson("no-concepts");
    const question = await createQuestion({ lessonId: lesson.id, prompt: "?", choices: ["a", "b"], correctIndex: 0 });
    const student = await makeStudent("questions-test-no-concepts@example.com");

    await gradeAttempt({ studentId: student.id, questionId: question.id, selectedIndex: 0 });

    expect(await prisma.conceptMasteryEvent.count({ where: { studentId: student.id } })).toBe(0);
    expect(await prisma.questionAttempt.count({ where: { studentId: student.id } })).toBe(1);
  });

  it("returns null instead of throwing when questionId doesn't exist", async () => {
    const student = await makeStudent("questions-test-badid@example.com");
    const result = await gradeAttempt({ studentId: student.id, questionId: "does-not-exist", selectedIndex: 0 });
    expect(result).toBeNull();
    expect(await prisma.questionAttempt.count({ where: { studentId: student.id } })).toBe(0);
  });
});
