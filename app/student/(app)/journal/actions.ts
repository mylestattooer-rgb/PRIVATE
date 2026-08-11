"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/app/lib/auth";
import { createTrade, deleteTrade, generateInsight } from "@/app/lib/domains/journal/journal";

// redirect() is called directly in each action body, not via a shared
// cross-module guard — see app/lib/auth.ts's note on the Next.js 16 redirect
// propagation quirk (SECURITY.md "Known Next.js 16 redirect quirk").

function parseOptionalFloat(value: FormDataEntryValue | null): number | undefined {
  const s = String(value ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function createTradeAction(formData: FormData) {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const symbol = String(formData.get("symbol") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const tradedAtRaw = String(formData.get("tradedAt") ?? "").trim();
  if (!symbol || !direction || !tradedAtRaw) return;

  await createTrade({
    studentId: session.sub,
    symbol,
    direction,
    tradedAt: new Date(tradedAtRaw),
    entryPrice: parseOptionalFloat(formData.get("entryPrice")),
    exitPrice: parseOptionalFloat(formData.get("exitPrice")),
    rMultiple: parseOptionalFloat(formData.get("rMultiple")),
    result: String(formData.get("result") ?? "").trim() || undefined,
    setupTag: String(formData.get("setupTag") ?? "").trim() || undefined,
    mistakeTag: String(formData.get("mistakeTag") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });

  revalidatePath("/student/journal");
}

export async function deleteTradeAction(formData: FormData) {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const tradeId = String(formData.get("tradeId") ?? "");
  if (!tradeId) return;

  await deleteTrade(session.sub, tradeId);
  revalidatePath("/student/journal");
}

export async function generateInsightAction() {
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  await generateInsight(session.sub);
  revalidatePath("/student/journal");
}
