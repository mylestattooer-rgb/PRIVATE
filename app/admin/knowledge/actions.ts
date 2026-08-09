"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { indexDocument } from "@/app/lib/ai/retrieval";

export async function uploadDocument(formData: FormData) {
  const session = await requireAdmin();

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
  const session = await requireAdmin();
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

export async function deleteDocument(formData: FormData) {
  const session = await requireAdmin();
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
