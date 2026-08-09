"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Citation = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  isSample: boolean;
  needsReview: boolean;
  score: number;
};

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  provider: string;
  citations: Citation[];
};

export default function ChatClient({
  conversationId,
  initialMessages,
  studentId,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  studentId?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);

    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "USER", content: text, provider: "n/a", citations: [] },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId, studentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      setMessages((m) => [...m, data.message]);

      if (!conversationId) {
        startTransition(() => router.push(`/admin/chat?c=${data.conversationId}`));
      } else {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: "SYSTEM",
          content: `Error: ${(err as Error).message}`,
          provider: "n/a",
          citations: [],
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">
            Ask a question about the methodology in the knowledge base. Answers cite their sources.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "USER" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap text-left ${
                m.role === "USER"
                  ? "bg-emerald-700 text-white"
                  : m.role === "SYSTEM"
                    ? "bg-red-950 text-red-300"
                    : "bg-neutral-800 text-neutral-100"
              }`}
            >
              {m.content}
              {m.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-neutral-700 pt-2">
                  {m.citations.map((c) => (
                    <span
                      key={c.chunkId}
                      className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400"
                      title={`similarity score ${c.score.toFixed(2)}`}
                    >
                      {c.documentTitle}
                      {c.isSample && " (sample)"}
                      {c.needsReview && " (needs review)"}
                    </span>
                  ))}
                </div>
              )}
              {m.role === "ASSISTANT" && (
                <p className="mt-1 text-[10px] uppercase tracking-wide text-neutral-500">
                  via {m.provider} provider
                </p>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-neutral-500">Thinking…</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant..."
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={sending || isPending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
