"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { createLesson, addLessonVersion, transitionLessonStatus } from "@/app/lib/domains/learning/lessons";
import { LESSON_STATUSES, type LessonStatusValue } from "@/app/lib/domains/learning/status";
import { createQuestion } from "@/app/lib/domains/assessment/questions";

// redirect() is called directly in each action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createLessonAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const moduleId = String(formData.get("moduleId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!moduleId || !title || !content) return;

  const lesson = await createLesson({ moduleId, title, slug: slugify(title), content, authorId: session.sub });

  await logAudit({
    actorId: session.sub,
    action: "LESSON_CREATED",
    detail: `Created lesson "${lesson.title}" (draft)`,
  });

  revalidatePath("/admin/curriculum");
}

export async function addLessonVersionAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const lessonId = String(formData.get("lessonId") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!lessonId || !content) return;

  const version = await addLessonVersion({ lessonId, content, authorId: session.sub });

  await logAudit({
    actorId: session.sub,
    action: "LESSON_UPDATED",
    detail: `Lesson ${lessonId} edited — new version ${version.version} (back to DRAFT)`,
  });

  revalidatePath("/admin/curriculum");
}

export async function transitionLessonAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const lessonId = String(formData.get("lessonId") ?? "");
  const to = String(formData.get("to") ?? "") as LessonStatusValue;
  if (!lessonId || !LESSON_STATUSES.includes(to)) return;

  const lesson = await transitionLessonStatus(lessonId, to);

  await logAudit({
    actorId: session.sub,
    action: to === "PUBLISHED" ? "LESSON_PUBLISHED" : "LESSON_UPDATED",
    detail: `Lesson "${lesson.title}" moved to ${to}`,
  });

  revalidatePath("/admin/curriculum");
}

export async function createQuestionAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const lessonId = String(formData.get("lessonId") ?? "");
  const prompt = String(formData.get("prompt") ?? "").trim();
  const choices = String(formData.get("choices") ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  const correctIndex = Number(formData.get("correctIndex") ?? -1);
  const explanation = String(formData.get("explanation") ?? "").trim() || undefined;

  if (!lessonId || !prompt || choices.length < 2 || !Number.isInteger(correctIndex)) return;
  if (correctIndex < 0 || correctIndex >= choices.length) return;

  const question = await createQuestion({ lessonId, prompt, choices, correctIndex, explanation });

  await logAudit({
    actorId: session.sub,
    action: "QUESTION_CREATED",
    detail: `Added question to lesson ${lessonId}: "${question.prompt.slice(0, 60)}"`,
  });

  revalidatePath("/admin/curriculum");
}
