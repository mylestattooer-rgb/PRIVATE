import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_DATABASE_URL } from "./prisma/test-db";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Cold full-suite runs (CI, first run after a reboot) have hit the default
    // 5000ms on auth.test.ts's first jose sign/verify call — reproduced once,
    // isolated re-runs are consistently ~1s. Not a logic bug (auth.ts itself
    // is unchanged), just no margin for a cold crypto-subsystem init.
    testTimeout: 15000,
    // Integration tests that touch a real Prisma Client (chartlab
    // exercises.test.ts) point at prisma/test.db, never prisma/dev.db —
    // globalSetup keeps that file's schema current.
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["./vitest.global-setup.ts"],
    // Gives each parallel worker its own copy of the template database. See
    // vitest.setup-worker.ts — sharing one SQLite file across workers failed
    // about one run in six on write contention.
    setupFiles: ["./vitest.setup-worker.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
