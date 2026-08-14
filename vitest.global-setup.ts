import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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
export default function setup() {
  const dbPath = path.join(import.meta.dirname, "prisma", "test.db");
  const schemaPath = path.join(import.meta.dirname, "prisma", "schema.prisma");

  const upToDate = existsSync(dbPath) && statSync(dbPath).mtimeMs > statSync(schemaPath).mtimeMs;
  if (upToDate) return;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: import.meta.dirname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
