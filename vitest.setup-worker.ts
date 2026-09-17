import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

// Per-worker database isolation.
//
// Four test files hit a real Prisma Client (assessment, chartlab, journal,
// learning) and Vitest runs test FILES in parallel workers. Pointed at one
// shared SQLite file they interleave writes, and SQLite serialises writers by
// failing the loser rather than queueing it. Measured: roughly one run in six
// failed, with the failure landing on a different test each time — the shape
// that gets waved off as "flaky" and then hides a real bug.
//
// Each worker instead gets its own copy of the schema-pushed template that
// globalSetup produces. Copying a small SQLite file is microseconds, so the
// parallelism is kept and the contention is gone.
//
// Keyed on pid rather than a Vitest worker variable so it does not depend on
// runner internals, and copied only when absent so a second test file in the
// same worker cannot overwrite a database its predecessor still has open.

const prismaDir = path.join(import.meta.dirname, "prisma");
const template = path.join(prismaDir, "test.db");
const perWorker = path.join(prismaDir, `test-${process.pid}.db`);

if (existsSync(template) && !existsSync(perWorker)) {
  copyFileSync(template, perWorker);
}

if (existsSync(perWorker)) {
  // Relative SQLite URLs resolve against schema.prisma's directory, not the
  // process cwd — so "./test-<pid>.db" lands in prisma/, same as the template.
  process.env.DATABASE_URL = `file:./test-${process.pid}.db`;
}
