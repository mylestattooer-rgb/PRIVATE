-- CreateTable
CREATE TABLE "ConceptMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NOT_INTRODUCED',
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "lastEvidenceAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConceptMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConceptMastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ConceptMastery_studentId_conceptId_key" ON "ConceptMastery"("studentId", "conceptId");
