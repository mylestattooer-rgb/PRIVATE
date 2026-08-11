-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiInsight_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_AiInsightToJournalTrade" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_AiInsightToJournalTrade_A_fkey" FOREIGN KEY ("A") REFERENCES "AiInsight" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_AiInsightToJournalTrade_B_fkey" FOREIGN KEY ("B") REFERENCES "JournalTrade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "_AiInsightToJournalTrade_AB_unique" ON "_AiInsightToJournalTrade"("A", "B");

-- CreateIndex
CREATE INDEX "_AiInsightToJournalTrade_B_index" ON "_AiInsightToJournalTrade"("B");
