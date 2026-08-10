"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { createStudentSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";

export async function studentLoginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const student = email ? await prisma.student.findUnique({ where: { email } }) : null;
  // authEnabledAt gates login separately from passwordHash existing, so a CRM
  // lead who was once given a password (e.g. during a later data migration)
  // still can't sign in until an admin/self-serve flow explicitly enables it.
  const canLogin = !!student?.passwordHash && !!student?.authEnabledAt;
  const valid = canLogin ? await bcrypt.compare(password, student!.passwordHash!) : false;

  if (!student || !canLogin || !valid) {
    redirect("/student/login?error=1");
  }

  await createStudentSession({ sub: student.id, email: student.email, name: student.name });
  // actorId stays null: AuditLog.actorId has a real FK to AdminUser, and a
  // Student id would violate that constraint. Student identity goes in
  // metadata instead — see DATABASE.md's "data integrity rules" note on
  // never widening a FK's meaning without a real schema change.
  await logAudit({
    action: "LOGIN",
    detail: `${student.email} (student) logged in`,
    metadata: { studentId: student.id },
  });
  redirect("/student");
}
