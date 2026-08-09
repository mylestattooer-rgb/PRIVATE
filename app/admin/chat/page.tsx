import Link from "next/link";
import { prisma } from "@/app/lib/db";
import ChatClient, { type ChatMessage } from "./ChatClient";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; studentId?: string }>;
}) {
  const { c: conversationId, studentId } = await searchParams;

  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: { student: true },
  });

  let initialMessages: ChatMessage[] = [];
  if (conversationId) {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { citations: { include: { chunk: { include: { document: true } } } } },
    });
    initialMessages = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      provider: m.provider,
      citations: m.citations.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.chunk.documentId,
        documentTitle: c.chunk.document.title,
        isSample: c.chunk.document.isSample,
        needsReview: c.chunk.document.needsReview,
        score: c.score,
      })),
    }));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">AI Assistant</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Retrieval is WORKING (local search over your knowledge base). Generation is{" "}
            {process.env.ANTHROPIC_API_KEY ? "WORKING (Anthropic)" : "MOCKED (no ANTHROPIC_API_KEY set)"}.
          </p>
        </div>
        <Link href="/admin/chat" className="text-sm text-emerald-400 hover:underline">
          + New conversation
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-1">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">History</p>
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/admin/chat?c=${c.id}`}
              className={`block rounded-md px-3 py-2 text-sm ${
                c.id === conversationId ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {c.title ?? "Untitled"}
              {c.student && <span className="block text-xs text-neutral-500">re: {c.student.name}</span>}
            </Link>
          ))}
          {conversations.length === 0 && <p className="px-1 text-sm text-neutral-600">No conversations yet.</p>}
        </div>

        <div className="lg:col-span-3">
          <ChatClient
            conversationId={conversationId ?? null}
            initialMessages={initialMessages}
            studentId={studentId}
          />
        </div>
      </div>
    </div>
  );
}
