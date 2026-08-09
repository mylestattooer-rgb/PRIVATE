// Seed data for local development / demo. Everything marked SAMPLE/placeholder here is
// generic and fictitious — it exists so the app is fully walkable before the real
// curriculum, methodology, and student data are provided. Nothing here should be read
// as the school's actual trading rules.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { indexDocument } from "../app/lib/ai/retrieval";

const prisma = new PrismaClient();

async function main() {
  // --- Admin user -----------------------------------------------------------
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@tradingschool.local";
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, passwordHash, name: "School Admin", role: "ADMIN" },
  });
  console.log(`Admin user ready: ${admin.email}`);

  // --- Curriculum modules (SAMPLE — placeholder topic labels) ---------------
  const moduleTitles = [
    "Multi-Timeframe Market Structure (sample)",
    "Accumulation, Distribution & Expansion (sample)",
    "Liquidity & Displacement (sample)",
    "Premium/Discount & OTE (sample)",
    "Fair Value Gaps & Imbalance (sample)",
    "Volume Profile: VAH / VAL / POC (sample)",
  ];
  const modules = [];
  for (let i = 0; i < moduleTitles.length; i++) {
    const title = moduleTitles[i];
    const slug = title
      .toLowerCase()
      .replace(/\(sample\)/, "")
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const mod = await prisma.module.upsert({
      where: { slug },
      update: {},
      create: { title, slug, orderIndex: i, description: "Placeholder curriculum module — replace with real content." },
    });
    modules.push(mod);
  }
  console.log(`${modules.length} curriculum modules ready.`);

  // --- Demo students ----------------------------------------------------------
  const studentsData = [
    { name: "Ava Whitfield", email: "ava.whitfield@example.com", status: "ACTIVE" as const, source: "referral" },
    { name: "Marcus Odei", email: "marcus.odei@example.com", status: "ACTIVE" as const, source: "youtube" },
    { name: "Priya Nandakumar", email: "priya.n@example.com", status: "TRIAL" as const, source: "instagram ad" },
    { name: "Tom Delacroix", email: "tom.delacroix@example.com", status: "PAUSED" as const, source: "referral" },
    { name: "Lena Furst", email: "lena.furst@example.com", status: "LEAD" as const, source: "webinar" },
  ];

  const students = [];
  for (const s of studentsData) {
    const student = await prisma.student.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, lastActiveAt: new Date() },
    });
    students.push(student);
  }
  console.log(`${students.length} demo students ready.`);

  // Notes + progress for the two active students
  const [ava, marcus, priya, tom] = students;

  // SQLite's createMany doesn't support skipDuplicates, so guard idempotency with a count check.
  const existingNoteCount = await prisma.note.count();
  if (existingNoteCount === 0) {
    await prisma.note.createMany({
      data: [
        { studentId: ava.id, body: "Strong on multi-timeframe alignment, still forcing entries in low-volume sessions.", pinned: true },
        { studentId: marcus.id, body: "Asked good questions about premium/discount zones during last office hours." },
        { studentId: tom.id, body: "Paused subscription — said work travel picked up. Follow up in 3 weeks." },
      ],
    });
  }

  await prisma.moduleProgress.upsert({
    where: { studentId_moduleId: { studentId: ava.id, moduleId: modules[0].id } },
    update: {},
    create: { studentId: ava.id, moduleId: modules[0].id, status: "COMPLETED", score: 92 },
  });
  await prisma.moduleProgress.upsert({
    where: { studentId_moduleId: { studentId: ava.id, moduleId: modules[1].id } },
    update: {},
    create: { studentId: ava.id, moduleId: modules[1].id, status: "IN_PROGRESS" },
  });
  await prisma.moduleProgress.upsert({
    where: { studentId_moduleId: { studentId: marcus.id, moduleId: modules[0].id } },
    update: {},
    create: { studentId: marcus.id, moduleId: modules[0].id, status: "IN_PROGRESS" },
  });
  await prisma.moduleProgress.upsert({
    where: { studentId_moduleId: { studentId: priya.id, moduleId: modules[0].id } },
    update: {},
    create: { studentId: priya.id, moduleId: modules[0].id, status: "NEEDS_REVIEW", score: 41 },
  });

  await prisma.crmActivity.createMany({
    data: [
      { studentId: priya.id, type: "FOLLOW_UP", summary: "Trial ends in 4 days — send check-in message." },
      { studentId: tom.id, type: "STATUS_CHANGE", summary: "Status changed to PAUSED" },
    ],
  });

  // --- Sample knowledge base documents (clearly labeled placeholder content) --
  const sampleDocs = [
    {
      title: "SAMPLE: Multi-Timeframe Structure Overview",
      content: `# Multi-Timeframe Structure Overview (SAMPLE)

> This is placeholder example content generated to demonstrate the knowledge base and AI
> assistant. It is NOT the school's confirmed methodology — replace it with real material.

## The idea

Higher timeframes set directional bias; lower timeframes are used for entry timing. A
"card" for each timeframe (M1, M5, M15, H1, H4, Daily, Weekly, Monthly) can be marked
aligned, conflicting, or neutral relative to the others.

## Why it matters (example framing)

Trading only when a majority of timeframe cards agree is one common way schools reduce
false signals — but this document is a placeholder and does not assert that this school
uses that exact rule.`,
    },
    {
      title: "SAMPLE: Liquidity & Displacement Glossary",
      content: `# Liquidity & Displacement Glossary (SAMPLE)

> Placeholder glossary content — not confirmed methodology.

**Liquidity**: Areas where resting orders are likely to cluster (e.g. above/below prior
swing highs/lows).

**Displacement**: A strong, often expansion-driven move away from a level, frequently
leaving a fair value gap / imbalance behind.

**Dealing range**: The range between a significant swing high and swing low used to
compute premium/discount and OTE (optimal trade entry) zones.`,
    },
    {
      title: "SAMPLE: Volume Profile Reference",
      content: `# Volume Profile Reference (SAMPLE)

> Placeholder reference content — not confirmed methodology.

- **POC (Point of Control)**: the price level with the highest traded volume in the
  session/range being profiled.
- **VAH / VAL (Value Area High / Low)**: the upper and lower bounds of the range
  containing a set percentage (commonly 70%) of traded volume.
- **Acceptance vs rejection**: price spending sustained time inside a level suggests
  acceptance; a fast move through it with little time spent suggests rejection.`,
    },
  ];

  for (const d of sampleDocs) {
    const existing = await prisma.document.findFirst({ where: { title: d.title } });
    const doc =
      existing ??
      (await prisma.document.create({
        data: {
          title: d.title,
          sourceType: "manual_entry",
          rawContent: d.content,
          status: "PROCESSING",
          isSample: true,
          tags: "sample,placeholder",
        },
      }));
    await indexDocument(doc.id);
  }
  console.log(`${sampleDocs.length} sample knowledge base documents ready.`);

  console.log("\nSeed complete.");
  console.log(`Log in with: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
