"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";

// redirect() is called directly in each action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

export async function createStudent(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const status = String(formData.get("status") ?? "LEAD") as
    | "LEAD"
    | "TRIAL"
    | "ACTIVE"
    | "PAUSED"
    | "CHURNED";
  const source = String(formData.get("source") ?? "").trim() || null;

  if (!name || !email) return;

  const student = await prisma.student.create({
    data: { name, email, status, source },
  });

  await logAudit({
    actorId: session.sub,
    action: "STUDENT_CREATED",
    detail: `Created student ${student.name} (${student.email})`,
  });

  revalidatePath("/admin/students");
  redirect(`/admin/students/${student.id}`);
}

export async function updateStudentStatus(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const studentId = String(formData.get("studentId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "LEAD"
    | "TRIAL"
    | "ACTIVE"
    | "PAUSED"
    | "CHURNED";
  if (!studentId || !status) return;

  const student = await prisma.student.update({ where: { id: studentId }, data: { status } });

  await prisma.crmActivity.create({
    data: { studentId, type: "STATUS_CHANGE", summary: `Status changed to ${status}` },
  });

  await logAudit({
    actorId: session.sub,
    action: "STUDENT_UPDATED",
    detail: `${student.name} status set to ${status}`,
  });

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/students");
}

export async function addNote(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const studentId = String(formData.get("studentId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!studentId || !body) return;

  await prisma.note.create({
    data: { studentId, authorId: session.sub, body },
  });

  await logAudit({
    actorId: session.sub,
    action: "NOTE_ADDED",
    detail: `Note added for student ${studentId}`,
  });

  revalidatePath(`/admin/students/${studentId}`);
}

export async function updateModuleProgress(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const studentId = String(formData.get("studentId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "NEEDS_REVIEW";
  if (!studentId || !moduleId || !status) return;

  await prisma.moduleProgress.upsert({
    where: { studentId_moduleId: { studentId, moduleId } },
    update: { status },
    create: { studentId, moduleId, status },
  });

  await logAudit({
    actorId: session.sub,
    action: "STUDENT_UPDATED",
    detail: `Progress updated for student ${studentId}`,
  });

  revalidatePath(`/admin/students/${studentId}`);
}
