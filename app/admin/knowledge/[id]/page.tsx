import { notFound } from "next/navigation";
import { marked } from "marked";
import { prisma } from "@/app/lib/db";
import { approveDocument } from "../actions";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) notFound();

  const html = await marked.parse(doc.rawContent);

  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold text-neutral-50">{doc.title}</h1>
        {doc.isSample && (
          <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300">
            SAMPLE placeholder content
          </span>
        )}
        {doc.needsReview && (
          <span className="rounded bg-orange-900 px-2 py-0.5 text-xs text-orange-300">NEEDS REVIEW</span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {doc.sourceType} · {doc.status} · uploaded {doc.createdAt.toLocaleString()}
      </p>

      {doc.needsReview && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-orange-900 bg-orange-950 px-4 py-3">
          <p className="text-sm text-orange-300">
            This content was extracted/adapted from another source and hasn&apos;t been confirmed by you yet.
            The AI assistant flags it as unconfirmed whenever it cites this document.
          </p>
          <form action={approveDocument}>
            <input type="hidden" name="id" value={doc.id} />
            <button
              type="submit"
              className="ml-4 shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Approve as confirmed
            </button>
          </form>
        </div>
      )}

      <article
        className="doc-render mt-6 max-w-none rounded-lg border border-neutral-800 bg-neutral-900 p-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
