"use server";

import { redirect } from "next/navigation";
import { destroyStudentSession } from "@/app/lib/auth";

export async function studentLogoutAction() {
  await destroyStudentSession();
  redirect("/student/login");
}
