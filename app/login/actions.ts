"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { createSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = email ? await prisma.adminUser.findUnique({ where: { email } }) : null;
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !valid) {
    redirect("/login?error=1");
  }

  await createSession({ sub: user.id, email: user.email, name: user.name });
  await logAudit({ actorId: user.id, action: "LOGIN", detail: `${user.email} logged in` });
  redirect("/admin");
}
