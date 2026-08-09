// One-off import for methodology content extracted from internal research notes
// (PROJECT_NOTES.md, RESEARCH_LOG.md, quant_platform/KNOWLEDGE_BASE.md) and generalized to strip
// proprietary strategy names, tuned parameters, and backtest performance figures per the admin's
// explicit instruction. Imported with needsReview=true — real content, not a SAMPLE placeholder,
// but not yet confirmed accurate/appropriate by a human. Run once: `npx tsx prisma/import-drafts.ts`

import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { indexDocument } from "../app/lib/ai/retrieval";

const prisma = new PrismaClient();

const DRAFTS = [
  { file: "draft_01_risk_sizing.md", title: "DRAFT: Risk Management — Adaptive Position Sizing & Guardrails" },
  { file: "draft_02_confluence_filters.md", title: "DRAFT: Signal Confluence — Why Multiple Filters Beat a Single Signal" },
  { file: "draft_03_backtesting_discipline.md", title: "DRAFT: Backtesting Discipline — Avoiding Self-Deception" },
  { file: "draft_04_liquidity_sessions.md", title: "DRAFT: Liquidity Sweeps & Session Context" },
  { file: "draft_05_regime_aware_design.md", title: "DRAFT: Regime-Aware Strategy Design" },
  { file: "draft_06_research_discipline.md", title: "DRAFT: Research Discipline — How We Evaluate Whether Something Actually Works" },
];

async function main() {
  for (const d of DRAFTS) {
    const content = readFileSync(join(__dirname, "draft-docs", d.file), "utf-8");

    const existing = await prisma.document.findFirst({ where: { title: d.title } });
    const doc =
      existing ??
      (await prisma.document.create({
        data: {
          title: d.title,
          sourceType: "manual_entry",
          rawContent: content,
          status: "PROCESSING",
          isSample: false,
          needsReview: true,
          tags: "draft,extracted,needs-review",
        },
      }));

    if (existing) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { rawContent: content, status: "PROCESSING" },
      });
    }

    await indexDocument(doc.id);
    console.log(`Imported: ${d.title}`);
  }

  console.log(`\n${DRAFTS.length} draft methodology documents imported, all marked needsReview=true.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
