// Local TF-IDF retrieval over uploaded knowledge-base chunks. No embeddings API,
// no external calls — this runs entirely in-process, so it's real/WORKING even
// with zero AI provider configured.

import { prisma } from "@/app/lib/db";
import type { RetrievedChunk } from "@/app/lib/ai/provider";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function vecNorm(v: Map<string, number>): number {
  let sumSq = 0;
  for (const w of v.values()) sumSq += w * w;
  return Math.sqrt(sumSq);
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, weight] of a) {
    const bw = b.get(term);
    if (bw) dot += weight * bw;
  }
  const normA = vecNorm(a);
  const normB = vecNorm(b);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

export async function retrieveRelevantChunks(query: string, limit = 5): Promise<RetrievedChunk[]> {
  const chunks = await prisma.documentChunk.findMany({
    where: { document: { status: "READY" } },
    include: { document: true },
  });
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const chunkTokensList = chunks.map((c) => tokenize(c.content));

  // Document frequency across all chunks, for IDF weighting.
  const df = new Map<string, number>();
  for (const tokens of chunkTokensList) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = chunks.length;
  const idf = (term: string) => Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  const toVec = (tf: Map<string, number>) => {
    const v = new Map<string, number>();
    for (const [term, freq] of tf) v.set(term, freq * idf(term));
    return v;
  };

  const queryVec = toVec(termFreq(queryTokens));

  const scored = chunks.map((c, i) => ({
    chunk: c,
    score: cosine(queryVec, toVec(termFreq(chunkTokensList[i]))),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.document.title,
      isSample: chunk.document.isSample,
      needsReview: chunk.document.needsReview,
      trustLevel: chunk.document.trustLevel,
      content: chunk.content,
      score,
    }));
}

export function chunkText(text: string, targetSize = 800): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && (current + "\n\n" + p).length > targetSize) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}

export async function indexDocument(documentId: string) {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const chunks = chunkText(doc.rawContent);
  await prisma.documentChunk.deleteMany({ where: { documentId } });
  await prisma.documentChunk.createMany({
    data: chunks.map((content, ordinal) => ({ documentId, ordinal, content })),
  });
  await prisma.document.update({ where: { id: documentId }, data: { status: "READY" } });
}
