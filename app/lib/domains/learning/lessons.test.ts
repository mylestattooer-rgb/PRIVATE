import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/app/lib/db";
import { createLesson, addLessonVersion, transitionLessonStatus } from "./lessons";

// prisma/test.db is dedicated to Vitest (see prisma/test-db.ts) — wiping
// these tables up front keeps repeated `npm test` runs idempotent instead of
// colliding on Module.slug's unique constraint.
beforeAll(async () => {
  await prisma.lessonVersion.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.module.deleteMany({ where: { slug: { contains: "lessons-test-" } } });
});

async function makeModule(slug: string) {
  return prisma.module.create({ data: { title: "Test Module", slug } });
}

describe("createLesson", () => {
  it("creates a lesson with a version 1, status DRAFT, no currentVersionId yet", async () => {
    const mod = await makeModule("lessons-test-create");
    const lesson = await createLesson({
      moduleId: mod.id,
      title: "What Is Market Structure?",
      slug: "what-is-market-structure",
      content: "Market structure is...",
    });

    expect(lesson.status).toBe("DRAFT");
    expect(lesson.currentVersionId).toBeNull();
    expect(lesson.versions).toHaveLength(1);
    expect(lesson.versions[0].version).toBe(1);
  });
});

describe("addLessonVersion", () => {
  it("creates version 2 and resets a PUBLISHED lesson back to DRAFT", async () => {
    const mod = await makeModule("lessons-test-addversion");
    const lesson = await createLesson({
      moduleId: mod.id,
      title: "Liquidity",
      slug: "liquidity",
      content: "v1 content",
    });
    await transitionLessonStatus(lesson.id, "REVIEW");
    await transitionLessonStatus(lesson.id, "PUBLISHED");

    const v2 = await addLessonVersion({ lessonId: lesson.id, content: "v2 content, corrected" });
    expect(v2.version).toBe(2);

    const reloaded = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    // In-progress students / AI citations tied to the old version keep
    // resolving correctly — currentVersionId only repoints on the next
    // publish, not immediately when a new draft version is added.
    expect(reloaded.status).toBe("DRAFT");
    expect(reloaded.currentVersionId).not.toBe(v2.id);
  });
});

describe("transitionLessonStatus", () => {
  it("moves currentVersionId to the latest version on publish", async () => {
    const mod = await makeModule("lessons-test-publish");
    const lesson = await createLesson({
      moduleId: mod.id,
      title: "Fair Value Gaps",
      slug: "fair-value-gaps",
      content: "v1",
    });

    await transitionLessonStatus(lesson.id, "REVIEW");
    const published = await transitionLessonStatus(lesson.id, "PUBLISHED");

    expect(published!.status).toBe("PUBLISHED");
    const version = await prisma.lessonVersion.findFirst({ where: { lessonId: lesson.id } });
    expect(published!.currentVersionId).toBe(version!.id);
    expect(version!.publishedAt).not.toBeNull();
  });

  it("rejects an invalid transition (DRAFT -> PUBLISHED, skipping REVIEW)", async () => {
    const mod = await makeModule("lessons-test-invalid");
    const lesson = await createLesson({
      moduleId: mod.id,
      title: "Volume Profile",
      slug: "volume-profile",
      content: "v1",
    });

    await expect(transitionLessonStatus(lesson.id, "PUBLISHED")).rejects.toThrow();
  });

  it("returns null instead of throwing when lessonId doesn't exist", async () => {
    const result = await transitionLessonStatus("does-not-exist", "REVIEW");
    expect(result).toBeNull();
  });
});
