"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { createChartExercise } from "@/app/lib/domains/chartlab/exercises";

// redirect() is called directly in this action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a chart screenshot, cheap to cap
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function createChartExerciseAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const file = formData.get("image");

  if (!title || !prompt || !(file instanceof File) || file.size === 0) return;
  if (file.size > MAX_IMAGE_BYTES) return;
  if (!ALLOWED_TYPES.includes(file.type)) return;

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageDataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

  const exercise = await createChartExercise({ title, prompt, imageDataUrl });

  await logAudit({
    actorId: session.sub,
    action: "CHART_EXERCISE_CREATED",
    detail: `Created chart exercise "${exercise.title}"`,
  });

  revalidatePath("/admin/chart-lab");
}
