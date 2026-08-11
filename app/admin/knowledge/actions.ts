"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { indexDocument } from "@/app/lib/ai/retrieval";

// redirect() is called directly in each action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

export async function uploadDocument(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const pasted = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");

  let content = pasted;
  if (file instanceof File && file.size > 0) {
    content = (await file.text()).trim();
  }

  if (!title || !content) return;

  const doc = await prisma.document.create({
    data: {
      title,
      sourceType: file instanceof File && file.size > 0 ? "markdown_upload" : "manual_entry",
      rawContent: content,
      status: "PROCESSING",
      isSample: false,
    },
  });

  await indexDocument(doc.id);

  await logAudit({
    actorId: session.sub,
    action: "DOCUMENT_UPLOADED",
    detail: `Uploaded knowledge doc "${doc.title}"`,
  });

  revalidatePath("/admin/knowledge");
  redirect("/admin/knowledge");
}

export async function approveDocument(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const doc = await prisma.document.update({ where: { id }, data: { needsReview: false } });

  await logAudit({
    actorId: session.sub,
    action: "DOCUMENT_UPLOADED",
    detail: `Approved knowledge doc "${doc.title}" as confirmed methodology`,
  });

  revalidatePath("/admin/knowledge");
  revalidatePath(`/admin/knowledge/${id}`);
}

const TRUST_LEVELS = ["A_OFFICIAL", "B_INSTRUCTOR_APPROVED", "C_REFERENCE", "D_COMMUNITY"] as const;

export async function setTrustLevelAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const trustLevel = String(formData.get("trustLevel") ?? "");
  if (!id || !(TRUST_LEVELS as readonly string[]).includes(trustLevel)) return;

  const doc = await prisma.document.update({
    where: { id },
    data: { trustLevel: trustLevel as (typeof TRUST_LEVELS)[number] },
  });

  await logAudit({
    actorId: session.sub,
    action: "DOCUMENT_UPLOADED",
    detail: `Set trust level of "${doc.title}" to ${trustLevel}`,
  });

  revalidatePath("/admin/knowledge");
  revalidatePath(`/admin/knowledge/${id}`);
}

export async function deleteDocument(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const doc = await prisma.document.delete({ where: { id } });

  await logAudit({
    actorId: session.sub,
    action: "DOCUMENT_UPLOADED",
    detail: `Deleted knowledge doc "${doc.title}"`,
  });

  revalidatePath("/admin/knowledge");
}
