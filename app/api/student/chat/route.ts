import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireStudentApi } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { retrieveRelevantChunks } from "@/app/lib/ai/retrieval";
import { getAiProvider } from "@/app/lib/ai/provider";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";

export async function POST(req: NextRequest) {
  const session = await requireStudentApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await studentCan(session.sub, CAPABILITIES.USE_AI_TUTOR);
  if (!allowed) return NextResponse.json({ error: "AI Tutor is not on your plan yet." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;

  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  // A student can only append to their OWN conversation — never accept an
  // arbitrary studentId/conversationId from the client the way the admin
  // route does (an admin may legitimately view any student's conversation;
  // a student may only ever see their own). Scoped by studentId at the
  // query layer, not just checked after the fact. findFirst (not
  // findUniqueOrThrow) so a mismatched id — someone else's conversation, or
  // a stale/bogus one — returns a clean 404 instead of an unhandled 500.
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId: session.sub, scope: "STUDENT" },
    });
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    conversation = await prisma.conversation.create({
      data: { scope: "STUDENT", studentId: session.sub, title: message.slice(0, 60) },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message, provider: "n/a" },
  });

  await logAudit({
    action: "AI_CHAT_QUERY",
    detail: `Query: "${message.slice(0, 120)}"`,
    metadata: { studentId: session.sub },
  });

  const chunks = await retrieveRelevantChunks(message, 5);
  const provider = getAiProvider();
  const result = await provider.answer(message, chunks);

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: result.text,
      provider: result.providerName,
      citations: {
        create: chunks
          .filter((c) => result.citedChunkIds.includes(c.chunkId))
          .map((c) => ({ chunkId: c.chunkId, score: c.score })),
      },
    },
    include: { citations: { include: { chunk: { include: { document: true } } } } },
  });

  await logAudit({
    action: "AI_CHAT_RESPONSE",
    detail: `Answered via ${result.providerName} provider (${chunks.length} sources retrieved)`,
    metadata: { studentId: session.sub },
  });

  return NextResponse.json({
    conversationId: conversation.id,
    message: {
      id: assistantMessage.id,
      role: "ASSISTANT",
      content: assistantMessage.content,
      provider: assistantMessage.provider,
      citations: assistantMessage.citations.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.chunk.documentId,
        documentTitle: c.chunk.document.title,
        isSample: c.chunk.document.isSample,
        needsReview: c.chunk.document.needsReview,
        trustLevel: c.chunk.document.trustLevel,
        score: c.score,
      })),
    },
  });
}
