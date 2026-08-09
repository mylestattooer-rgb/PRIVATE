import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdminApi } from "@/app/lib/auth";
import { logAudit } from "@/app/lib/audit";
import { retrieveRelevantChunks } from "@/app/lib/ai/retrieval";
import { getAiProvider } from "@/app/lib/ai/provider";

export async function POST(req: NextRequest) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
  const studentId = typeof body?.studentId === "string" ? body.studentId : undefined;

  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const conversation = conversationId
    ? await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    : await prisma.conversation.create({
        data: {
          scope: "ADMIN",
          studentId: studentId ?? null,
          title: message.slice(0, 60),
        },
      });

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message, provider: "n/a" },
  });

  await logAudit({
    actorId: session.sub,
    action: "AI_CHAT_QUERY",
    detail: `Query: "${message.slice(0, 120)}"`,
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
    actorId: session.sub,
    action: "AI_CHAT_RESPONSE",
    detail: `Answered via ${result.providerName} provider (${chunks.length} sources retrieved)`,
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
        score: c.score,
      })),
    },
  });
}
