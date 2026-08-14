// Shared by vitest.config.mts (sets DATABASE_URL for the test process) and
// vitest.global-setup.ts (pushes the schema to that same file) so the two
// can't drift apart into pointing at different databases.
//
// Relative SQLite URLs in schema.prisma resolve against the schema file's
// own directory (prisma/), not the process cwd — same reason dev's
// "file:./dev.db" lands at prisma/dev.db, not the repo root. "./test.db"
// here means prisma/test.db, matching vitest.global-setup.ts's dbPath.
export const TEST_DATABASE_URL = "file:./test.db";
