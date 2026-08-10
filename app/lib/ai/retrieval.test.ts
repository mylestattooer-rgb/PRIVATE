import { describe, expect, it, vi } from "vitest";
import { chunkText } from "./retrieval";

describe("chunkText", () => {
  it("keeps short content as a single chunk", () => {
    expect(chunkText("One short paragraph.")).toEqual(["One short paragraph."]);
  });

  it("groups paragraphs until targetSize, then starts a new chunk", () => {
    const a = "a".repeat(500);
    const b = "b".repeat(500);
    const chunks = chunkText(`${a}\n\n${b}`, 800);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  it("keeps paragraphs together when combined length is under targetSize", () => {
    const chunks = chunkText("Para one.\n\nPara two.", 800);
    expect(chunks).toEqual(["Para one.\n\nPara two."]);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(chunkText("   \n\n   ")).toEqual([]);
  });
});

describe("retrieveRelevantChunks", () => {
  async function withMockedChunks(rows: unknown[]) {
    vi.resetModules();
    vi.doMock("@/app/lib/db", () => ({
      prisma: { documentChunk: { findMany: vi.fn().mockResolvedValue(rows) } },
    }));
    const mod = await import("./retrieval");
    return mod.retrieveRelevantChunks;
  }

  const doc = (overrides: Partial<{ isSample: boolean; needsReview: boolean; title: string }> = {}) => ({
    isSample: false,
    needsReview: false,
    title: "Doc",
    ...overrides,
  });

  it("ranks the chunk whose vocabulary matches the query above an unrelated chunk", async () => {
    const retrieveRelevantChunks = await withMockedChunks([
      {
        id: "chunk-liquidity",
        documentId: "doc-1",
        content: "Liquidity sweeps occur when price takes out resting orders above a prior swing high.",
        document: doc({ title: "Liquidity & Sessions" }),
      },
      {
        id: "chunk-risk",
        documentId: "doc-2",
        content: "Position sizing formulas convert a percentage risk into a lot size given stop distance.",
        document: doc({ title: "Risk Sizing" }),
      },
    ]);

    const results = await retrieveRelevantChunks("liquidity sweep prior swing high");

    expect(results[0].chunkId).toBe("chunk-liquidity");
    expect(results[0].score).toBeGreaterThan(0);
    expect(results.some((r) => r.chunkId === "chunk-risk")).toBe(false);
  });

  it("passes isSample/needsReview through from the source document", async () => {
    const retrieveRelevantChunks = await withMockedChunks([
      {
        id: "chunk-1",
        documentId: "doc-1",
        content: "Backtesting discipline means avoiding self-deception in sample selection.",
        document: doc({ isSample: true, needsReview: true }),
      },
    ]);

    const [result] = await retrieveRelevantChunks("backtesting discipline");
    expect(result.isSample).toBe(true);
    expect(result.needsReview).toBe(true);
  });

  it("returns an empty array when there are no chunks to search", async () => {
    const retrieveRelevantChunks = await withMockedChunks([]);
    expect(await retrieveRelevantChunks("anything")).toEqual([]);
  });

  it("returns an empty array for a query with no meaningful tokens", async () => {
    const retrieveRelevantChunks = await withMockedChunks([
      { id: "c1", documentId: "d1", content: "Some real content here.", document: doc() },
    ]);
    expect(await retrieveRelevantChunks("to a")).toEqual([]);
  });
});
