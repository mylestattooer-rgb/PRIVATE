// AI provider abstraction — keeps the app from being locked into one model vendor.
//
// PROVIDER SELECTION: set ANTHROPIC_API_KEY in .env to use the real Anthropic provider.
// With no key configured, the app falls back to MockProvider so the whole product still
// runs end-to-end with zero external dependencies. MockProvider answers are template-built
// strictly from retrieved knowledge-base chunks — it never invents methodology.

// Kept as a plain string union (not imported from @prisma/client) so this
// leaf module stays decoupled from the Prisma-generated types — matches
// isSample/needsReview already being plain booleans here, not enum imports.
export type TrustLevel = "A_OFFICIAL" | "B_INSTRUCTOR_APPROVED" | "C_REFERENCE" | "D_COMMUNITY";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  isSample: boolean;
  needsReview: boolean;
  trustLevel: TrustLevel;
  content: string;
  score: number;
};

export type AiAnswer = {
  text: string;
  providerName: string;
  citedChunkIds: string[];
};

export interface AiProvider {
  name: string;
  answer(question: string, context: RetrievedChunk[]): Promise<AiAnswer>;
}

// --- Mock provider (default, zero external calls) --------------------------

class MockProvider implements AiProvider {
  name = "mock";

  async answer(question: string, context: RetrievedChunk[]): Promise<AiAnswer> {
    if (context.length === 0) {
      return {
        text:
          "I don't have anything in the knowledge base yet that speaks to this. " +
          "Upload methodology documents under Knowledge Base and I'll be able to answer from them. " +
          "I won't guess at trading rules that haven't been provided.",
        providerName: this.name,
        citedChunkIds: [],
      };
    }

    const sampleWarning = context.some((c) => c.isSample)
      ? "\n\n_Note: this answer draws on SAMPLE placeholder content, not your real methodology yet._"
      : "";
    const reviewWarning = context.some((c) => c.needsReview)
      ? "\n\n_Note: this answer draws on content that hasn't been confirmed by an admin yet — treat it as unconfirmed, not established methodology._"
      : "";
    const communityWarning = context.some((c) => c.trustLevel === "D_COMMUNITY")
      ? "\n\n_Note: this answer draws on community-submitted content, not official school methodology — treat it as one student's perspective, not a confirmed rule._"
      : "";

    const body = context
      .slice(0, 3)
      .map((c, i) => `(${i + 1}) From "${c.documentTitle}":\n${truncate(c.content, 420)}`)
      .join("\n\n");

    const text =
      `Here's what the knowledge base says relevant to "${question.trim()}":\n\n${body}` +
      sampleWarning +
      reviewWarning +
      communityWarning +
      "\n\n_This is a template response from the mock AI provider (no ANTHROPIC_API_KEY configured) — " +
      "it surfaces and quotes your source material rather than reasoning over it. " +
      "Set ANTHROPIC_API_KEY to enable full generative answers over the same sources._";

    return {
      text,
      providerName: this.name,
      citedChunkIds: context.slice(0, 3).map((c) => c.chunkId),
    };
  }
}

// --- Anthropic provider (real, activates when ANTHROPIC_API_KEY is set) ----

class AnthropicProvider implements AiProvider {
  name = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-5") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async answer(question: string, context: RetrievedChunk[]): Promise<AiAnswer> {
    const sources = context
      .map((c, i) => {
        const flags = [
          c.isSample && "SAMPLE placeholder content",
          c.needsReview && "NOT YET CONFIRMED by an admin",
          `trust level: ${c.trustLevel}`,
        ]
          .filter(Boolean)
          .join(", ");
        return `[Source ${i + 1}: "${c.documentTitle}"${flags ? ` — ${flags}` : ""}]\n${c.content}`;
      })
      .join("\n\n");

    const system =
      "You are the trading education assistant for a day-trading school. Answer ONLY using the " +
      "provided source excerpts, which are the school's own methodology material. Do not introduce " +
      "outside trading concepts or rules as if they were the school's methodology. If the sources don't " +
      "cover the question, say so plainly instead of guessing. When you state a rule or definition, note " +
      "which source it came from. If any source is marked SAMPLE placeholder content, tell the student " +
      "this is example material, not confirmed methodology. If any source is marked NOT YET CONFIRMED, " +
      "tell the student this content hasn't been reviewed/approved by the school yet and should be treated " +
      "as provisional, not settled. Each source also carries a trust level: A_OFFICIAL (published " +
      "curriculum) and B_INSTRUCTOR_APPROVED (reviewed instructor material) can be presented with normal " +
      "confidence; C_REFERENCE (general reference material) should be presented as background, not a " +
      "school rule; D_COMMUNITY (student-submitted content) must be presented as one student's " +
      "perspective, never as official school methodology, regardless of how confidently it's phrased in " +
      "the source text.";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [
          {
            role: "user",
            content: `Source material:\n\n${sources || "(no matching sources found)"}\n\nStudent question: ${question}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((b) => b.type === "text")?.text ?? "";

    return {
      text,
      providerName: this.name,
      citedChunkIds: context.map((c) => c.chunkId),
    };
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  cached = key ? new AnthropicProvider(key) : new MockProvider();
  return cached;
}
