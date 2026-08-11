import { redirect } from "next/navigation";
import Link from "next/link";
import { getStudentSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/db";
import { studentCan, CAPABILITIES } from "@/app/lib/domains/entitlements";
import ChatClient, { type ChatMessage } from "@/app/admin/chat/ChatClient";

export default async function StudentAiTutorPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  // redirect() must be called directly in this component's body, not via an
  // awaited cross-module helper — see SECURITY.md "Known Next.js 16 redirect
  // quirk".
  const session = await getStudentSession();
  if (!session) redirect("/student/login");

  const { c: conversationId } = await searchParams;
  const allowed = await studentCan(session.sub, CAPABILITIES.USE_AI_TUTOR);

  // Scoped by studentId at the query layer, not just hidden in the UI — a
  // student can only ever list or open their own conversations.
  const conversations = await prisma.conversation.findMany({
    where: { studentId: session.sub, scope: "STUDENT" },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  let initialMessages: ChatMessage[] = [];
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId: session.sub, scope: "STUDENT" },
    });
    if (conversation) {
      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
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
          trustLevel: c.chunk.document.trustLevel,
          score: c.score,
        })),
      }));
    }
  }

  if (!allowed) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-neutral-50">AI Tutor</h1>
        <p className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
          The AI Tutor isn&apos;t on your current plan yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">AI Tutor</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Ask about anything in the knowledge base — answers cite their sources and flag
            whether they&apos;re official, instructor-approved, reference, or community content.
          </p>
        </div>
        <Link href="/student/ai-tutor" className="text-sm text-emerald-400 hover:underline">
          + New conversation
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-1">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">History</p>
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/student/ai-tutor?c=${c.id}`}
              className={`block rounded-md px-3 py-2 text-sm ${
                c.id === conversationId ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {c.title ?? "Untitled"}
            </Link>
          ))}
          {conversations.length === 0 && <p className="px-1 text-sm text-neutral-600">No conversations yet.</p>}
        </div>

        <div className="lg:col-span-3">
          <ChatClient
            conversationId={conversationId ?? null}
            initialMessages={initialMessages}
            endpoint="/api/student/chat"
            historyBasePath="/student/ai-tutor"
          />
        </div>
      </div>
    </div>
  );
}
