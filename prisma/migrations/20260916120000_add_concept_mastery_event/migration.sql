-- CreateTable
CREATE TABLE "ConceptMasteryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "attemptId" TEXT,
    "correct" BOOLEAN NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "fromStreak" INTEGER NOT NULL,
    "toStreak" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConceptMasteryEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConceptMasteryEvent_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConceptMasteryEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ConceptMasteryEvent_studentId_conceptId_createdAt_idx" ON "ConceptMasteryEvent"("studentId", "conceptId", "createdAt");
