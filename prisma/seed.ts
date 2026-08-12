// Seed data for local development / demo. Everything marked SAMPLE/placeholder here is
// generic and fictitious — it exists so the app is fully walkable before the real
// curriculum, methodology, and student data are provided. Nothing here should be read
// as the school's actual trading rules.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { indexDocument } from "../app/lib/ai/retrieval";
import { createLesson, addLessonVersion, transitionLessonStatus } from "../app/lib/domains/learning/lessons";
import { createQuestion } from "../app/lib/domains/assessment/questions";
import { ACHIEVEMENT_KEYS } from "../app/lib/domains/progression/achievements";
import { createTrade, generateInsight } from "../app/lib/domains/journal/journal";
import { createChartExercise } from "../app/lib/domains/chartlab/exercises";

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

  // --- Default plan (entitlements, ARCHITECTURE.md) --------------------------
  const freePlan = await prisma.plan.upsert({
    where: { name: "free" },
    update: {},
    create: { name: "free", capabilities: "USE_AI_TUTOR" },
  });
  console.log(`Plan ready: ${freePlan.name} (${freePlan.capabilities})`);

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

  // --- Course wrapping the sample modules, + curriculum-versioning proof (SAMPLE) ---
  const course = await prisma.course.upsert({
    where: { slug: "foundations" },
    update: {},
    create: {
      title: "Foundations (sample)",
      slug: "foundations",
      description: "Placeholder course grouping — replace with real course structure.",
      orderIndex: 0,
    },
  });
  await prisma.module.updateMany({ where: { courseId: null }, data: { courseId: course.id } });
  console.log(`Course ready: ${course.title}, modules assigned.`);

  const conceptDefs = [
    { name: "Market Structure", slug: "market-structure", description: "Swing highs/lows and trend direction (sample)." },
    { name: "Liquidity", slug: "liquidity", description: "Where resting orders cluster (sample)." },
    { name: "Multi-Timeframe Alignment", slug: "mtf-alignment", description: "Using higher timeframes for bias (sample)." },
  ];
  const concepts = [];
  for (const c of conceptDefs) {
    concepts.push(await prisma.concept.upsert({ where: { slug: c.slug }, update: {}, create: c }));
  }
  console.log(`${concepts.length} concepts ready.`);

  // Two lessons under the first module, demonstrating the full versioning
  // workflow: one published (with a superseded draft v1 kept in history),
  // one still in draft — so the admin UI has something real to show on
  // first load, not an empty state.
  const existingLessons = await prisma.lesson.count({ where: { moduleId: modules[0].id } });
  if (existingLessons === 0) {
    const publishedLesson = await createLesson({
      moduleId: modules[0].id,
      title: "What Is Market Structure? (sample)",
      slug: "what-is-market-structure",
      content:
        "# What Is Market Structure? (SAMPLE)\n\n> Placeholder lesson content — not confirmed methodology.\n\nMarket structure describes the sequence of swing highs and lows that define whether price is trending up, trending down, or ranging.",
      authorId: admin.id,
    });
    await addLessonVersion({
      lessonId: publishedLesson.id,
      content:
        "# What Is Market Structure? (SAMPLE)\n\n> Placeholder lesson content — not confirmed methodology.\n\nMarket structure describes the sequence of swing highs and lows that define whether price is trending up, trending down, or ranging. A break of structure (BOS) is when price closes beyond a prior swing point in the direction of the trend.",
      authorId: admin.id,
    });
    await transitionLessonStatus(publishedLesson.id, "REVIEW");
    await transitionLessonStatus(publishedLesson.id, "PUBLISHED");
    await prisma.lesson.update({
      where: { id: publishedLesson.id },
      data: { concepts: { connect: [{ id: concepts[0].id }] } },
    });

    const draftLesson = await createLesson({
      moduleId: modules[0].id,
      title: "Reading Multi-Timeframe Alignment (sample, draft)",
      slug: "reading-mtf-alignment",
      content:
        "# Reading Multi-Timeframe Alignment (SAMPLE, DRAFT)\n\n> Placeholder — still being drafted, not yet reviewed.",
      authorId: admin.id,
    });
    await prisma.lesson.update({
      where: { id: draftLesson.id },
      data: { concepts: { connect: [{ id: concepts[1].id }, { id: concepts[2].id }] } },
    });

    console.log("2 sample lessons ready (1 published, 1 draft) demonstrating curriculum versioning.");
  }

  // --- Levels (Phase 2, DATABASE.md §2.5) — admin-configurable thresholds ---
  const levelDefs = [
    { name: "Market Orientation", xpThreshold: 0 },
    { name: "Foundations", xpThreshold: 50 },
    { name: "Chart Reading", xpThreshold: 150 },
    { name: "Market Structure", xpThreshold: 300 },
  ];
  for (const l of levelDefs) {
    await prisma.level.upsert({ where: { xpThreshold: l.xpThreshold }, update: {}, create: l });
  }
  console.log(`${levelDefs.length} levels ready.`);

  // --- Achievements (Phase 2) --------------------------------------------------
  await prisma.achievement.upsert({
    where: { key: ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED },
    update: {},
    create: {
      key: ACHIEVEMENT_KEYS.FIRST_QUIZ_PASSED,
      name: "First Quiz Passed",
      description: "Answered a quiz question correctly for the first time.",
    },
  });
  console.log("Achievement definitions ready.");

  // --- Quiz questions on the published sample lesson (Phase 2) ----------------
  const marketStructureLesson = await prisma.lesson.findFirst({ where: { slug: "what-is-market-structure" } });
  if (marketStructureLesson) {
    const existingQuestions = await prisma.question.count({ where: { lessonId: marketStructureLesson.id } });
    if (existingQuestions === 0) {
      await createQuestion({
        lessonId: marketStructureLesson.id,
        prompt: "What does a break of structure (BOS) indicate? (sample question)",
        choices: [
          "Price closed beyond a prior swing point in the trend direction",
          "Price touched a round number",
          "Volume increased on a single candle",
          "A new session opened",
        ],
        correctIndex: 0,
        explanation: "A BOS is defined by price closing beyond a prior swing point, continuing the trend.",
        conceptIds: [concepts[0].id],
      });
      await createQuestion({
        lessonId: marketStructureLesson.id,
        prompt: "Which sequence describes an uptrend in market structure? (sample)",
        choices: [
          "Higher highs and higher lows",
          "Lower highs and lower lows",
          "Equal highs and equal lows",
          "Random highs and lows",
        ],
        correctIndex: 0,
        explanation: "An uptrend is defined by a sequence of higher highs and higher lows (sample).",
        conceptIds: [concepts[0].id],
      });
      console.log("2 sample quiz questions ready.");
    }
  }

  // --- Chart Lab (Phase 5, sample) ---------------------------------------------
  // A minimal placeholder "chart" (SVG, not a real screenshot) so the demo has
  // something real to show without needing an actual chart image on disk.
  const existingExercises = await prisma.chartExercise.count();
  if (existingExercises === 0) {
    const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#0a0a0a"/>
      <text x="20" y="30" fill="#525252" font-family="monospace" font-size="14">SAMPLE — placeholder chart, not real price data</text>
      ${[80, 140, 200, 260, 320, 380, 440, 500, 560].map((x, i) => {
        const open = 150 + (i % 3) * 20;
        const close = open + (i % 2 === 0 ? -40 : 30);
        const high = Math.min(open, close) - 15;
        const low = Math.max(open, close) + 15;
        const color = close < open ? "#34d399" : "#f87171";
        return `<line x1="${x}" y1="${high}" x2="${x}" y2="${low}" stroke="${color}" stroke-width="2"/><rect x="${x - 8}" y="${Math.min(open, close)}" width="16" height="${Math.abs(close - open) || 2}" fill="${color}"/>`;
      }).join("\n")}
    </svg>`;
    const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString("base64")}`;

    await createChartExercise({
      title: "Identify the break of structure (sample)",
      prompt: "What do you see happening in this chart? Where, if anywhere, does structure break?",
      imageDataUrl,
      conceptIds: [concepts[0].id],
    });
    console.log("1 sample chart exercise ready.");
  }

  // --- Demo students ----------------------------------------------------------
  // canLogin: only ACTIVE students get a login-capable account seeded, matching
  // the real intent of Student.authEnabledAt — a LEAD/TRIAL/PAUSED CRM record
  // hasn't necessarily been given student-portal access yet.
  const studentsData = [
    { name: "Ava Whitfield", email: "ava.whitfield@example.com", status: "ACTIVE" as const, source: "referral", canLogin: true },
    { name: "Marcus Odei", email: "marcus.odei@example.com", status: "ACTIVE" as const, source: "youtube", canLogin: true },
    { name: "Priya Nandakumar", email: "priya.n@example.com", status: "TRIAL" as const, source: "instagram ad", canLogin: false },
    { name: "Tom Delacroix", email: "tom.delacroix@example.com", status: "PAUSED" as const, source: "referral", canLogin: false },
    { name: "Lena Furst", email: "lena.furst@example.com", status: "LEAD" as const, source: "webinar", canLogin: false },
  ];

  const studentPassword = process.env.STUDENT_SEED_PASSWORD ?? "ChangeMe123!";
  const studentPasswordHash = await bcrypt.hash(studentPassword, 10);

  const students = [];
  for (const { canLogin, ...s } of studentsData) {
    // update: (not `{}`) so re-running the seed against a DB from before a
    // schema change (e.g. planId/passwordHash didn't exist yet) still
    // converges existing rows to the intended demo state, not just new ones.
    const authFields = canLogin ? { passwordHash: studentPasswordHash, authEnabledAt: new Date() } : {};
    const student = await prisma.student.upsert({
      where: { email: s.email },
      update: { planId: freePlan.id, ...authFields },
      create: { ...s, lastActiveAt: new Date(), planId: freePlan.id, ...authFields },
    });
    students.push(student);
  }
  console.log(`${students.length} demo students ready.`);
  console.log(`Student login (ACTIVE students only): <their email> / ${studentPassword}`);

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

  // --- Trading journal (Phase 3, sample) — enough trades to clear
  // MIN_TRADES_FOR_INSIGHT so the seeded demo can show a real generated
  // insight, not just an empty state.
  const existingTradeCount = await prisma.journalTrade.count({ where: { studentId: ava.id } });
  if (existingTradeCount === 0) {
    const day = (offset: number) => new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    const sampleTrades = [
      { symbol: "XAUUSD", direction: "long", result: "win", rMultiple: 2.1, setupTag: "displacement+FVG", tradedAt: day(1) },
      { symbol: "XAUUSD", direction: "long", result: "win", rMultiple: 1.8, setupTag: "displacement+FVG", tradedAt: day(3) },
      { symbol: "XAUUSD", direction: "short", result: "loss", rMultiple: -1, setupTag: "liquidity sweep", mistakeTag: "early entry", tradedAt: day(5) },
      { symbol: "XAUUSD", direction: "short", result: "loss", rMultiple: -1, setupTag: "liquidity sweep", mistakeTag: "early entry", tradedAt: day(7) },
      { symbol: "XAUUSD", direction: "long", result: "win", rMultiple: 3, setupTag: "displacement+FVG", tradedAt: day(9) },
      { symbol: "XAUUSD", direction: "long", result: "breakeven", rMultiple: 0, setupTag: "displacement+FVG", tradedAt: day(11) },
    ];
    for (const t of sampleTrades) {
      await createTrade({ studentId: ava.id, notes: "Sample journal entry (placeholder).", ...t });
    }
    const insight = await generateInsight(ava.id);
    console.log(`${sampleTrades.length} sample journal trades ready.${insight ? " 1 sample insight generated." : ""}`);
  }

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
