import Link from "next/link";
import { prisma } from "@/app/lib/db";
import { uploadDocument, deleteDocument, approveDocument } from "./actions";

export default async function KnowledgePage() {
  const docs = await prisma.document.findMany({
    orderBy: [{ needsReview: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { chunks: true } } },
  });
  const reviewCount = docs.filter((d) => d.needsReview).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-50">Knowledge Base</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Upload Markdown/text documents. WORKING: retrieval is real local TF-IDF search over these
        documents — no external embeddings API involved.
      </p>
      {reviewCount > 0 && (
        <p className="mt-3 rounded-md border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
          {reviewCount} document{reviewCount === 1 ? "" : "s"} extracted from other sources and awaiting your
          review before being treated as confirmed methodology. The AI assistant will flag them as unconfirmed
          when it cites them.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
            >
              <div>
                <Link href={`/admin/knowledge/${d.id}`} className="text-sm font-medium text-neutral-100 hover:underline">
                  {d.title}
                </Link>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {d.sourceType} · {d._count.chunks} chunks · {d.status}
                  {d.isSample && (
                    <span className="ml-2 rounded bg-amber-900 px-1.5 py-0.5 text-amber-300">SAMPLE</span>
                  )}
                  {d.needsReview && (
                    <span className="ml-2 rounded bg-orange-900 px-1.5 py-0.5 text-orange-300">NEEDS REVIEW</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {d.needsReview && (
                  <form action={approveDocument}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="text-xs text-emerald-400 hover:text-emerald-300">
                      Approve
                    </button>
                  </form>
                )}
                <form action={deleteDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
          {docs.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              No documents yet. Upload your methodology material to get started.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 h-fit">
          <h2 className="text-sm font-semibold text-neutral-200">Upload document</h2>
          <form action={uploadDocument} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-neutral-400">Title</label>
              <input
                name="title"
                required
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">Markdown/text file (.md, .txt)</label>
              <input
                name="file"
                type="file"
                accept=".md,.markdown,.txt"
                className="mt-1 w-full text-xs text-neutral-300 file:mr-2 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-100"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400">...or paste content directly</label>
              <textarea
                name="content"
                rows={6}
                placeholder="# My methodology..."
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Upload &amp; index
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
