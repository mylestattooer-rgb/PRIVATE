import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { TEST_DATABASE_URL } from "./prisma/test-db";

// Runs once before the whole test-file suite (a separate process from the
// tests themselves, per Vitest's globalSetup contract) so integration tests
// that hit a real Prisma Client (chartlab exercises.test.ts) have an
// up-to-date schema to run against, without touching prisma/dev.db.
//
// `prisma db push` shells out to a fresh CLI process — ~50s of pure Node/CLI
// cold-start overhead on this machine, dwarfing the actual test run, even
// when the schema hasn't changed since last time. Skip it unless test.db is
// missing or schema.prisma is newer (mtime), so an unrelated `npm test` run
// stays fast; a real schema change still gets picked up automatically.
const PRISMA_DIR = path.join(import.meta.dirname, "prisma");

/** Remove the per-worker database copies (see vitest.setup-worker.ts). They are
 *  keyed on pid, so without sweeping they accumulate one file per worker per
 *  run indefinitely. Swept on the way out AND on the way in, because a crashed
 *  or killed run never reaches its teardown. */
function sweepWorkerDatabases(): void {
  for (const file of readdirSync(PRISMA_DIR)) {
    if (/^test-\d+\.db(-journal|-wal|-shm)?$/.test(file)) {
      rmSync(path.join(PRISMA_DIR, file), { force: true });
    }
  }
}

export default function setup() {
  sweepWorkerDatabases();

  const prismaDir = PRISMA_DIR;
  const dbPath = path.join(prismaDir, "test.db");
  const schemaPath = path.join(prismaDir, "schema.prisma");

  const upToDate = existsSync(dbPath) && statSync(dbPath).mtimeMs > statSync(schemaPath).mtimeMs;
  if (upToDate) return sweepWorkerDatabases;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: import.meta.dirname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });

  return sweepWorkerDatabases;
}
