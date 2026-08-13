"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";
import { submitChartAnswer, submitFollowUpResponse } from "@/app/lib/domains/chartlab/exercises";

// redirect() is called directly in each action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

// Defense in depth, same posture as api/student/chat/route.ts's 403: the
// page above already hides the form for a student without USE_CHART_LAB, but
// a Server Action is a public endpoint in its own right and must re-check.
// Silent no-op (not a redirect/throw) matches this file's existing
// convention for a rejected submission (see the chartExerciseId/response
// guards below).

export async function submitChartAnswerAction(formData: FormData) {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const allowed = await studentCan(session.sub, CAPABILITIES.USE_CHART_LAB);
  if (!allowed) return;

  const chartExerciseId = String(formData.get("chartExerciseId") ?? "");
  const response = String(formData.get("response") ?? "").trim();
  if (!chartExerciseId || !response) return;

  await submitChartAnswer({ studentId: session.sub, chartExerciseId, response });
  revalidatePath("/student/chart-lab");
}

export async function submitFollowUpResponseAction(formData: FormData) {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const allowed = await studentCan(session.sub, CAPABILITIES.USE_CHART_LAB);
  if (!allowed) return;

  const chartAnswerId = String(formData.get("chartAnswerId") ?? "");
  const response = String(formData.get("response") ?? "").trim();
  if (!chartAnswerId || !response) return;

  await submitFollowUpResponse({ studentId: session.sub, chartAnswerId, response });
  revalidatePath("/student/chart-lab");
}
