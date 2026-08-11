"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { gradeAttempt } from "@/app/lib/domains/assessment/questions";

// redirect() is called directly in this action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

export async function submitAnswerAction(formData: FormData) {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const lessonId = String(formData.get("lessonId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const selectedIndex = Number(formData.get("selectedIndex") ?? -1);
  if (!lessonId || !questionId || !Number.isInteger(selectedIndex) || selectedIndex < 0) return;

  await gradeAttempt({ studentId: session.sub, questionId, selectedIndex });

  revalidatePath(`/student/lessons/${lessonId}`);
}
