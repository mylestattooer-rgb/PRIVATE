-- CreateTable
CREATE TABLE "ChartExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageDataUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChartAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "chartExerciseId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "followUpQuestion" TEXT,
    "followUpResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChartAnswer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChartAnswer_chartExerciseId_fkey" FOREIGN KEY ("chartExerciseId") REFERENCES "ChartExercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ChartExerciseToConcept" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ChartExerciseToConcept_A_fkey" FOREIGN KEY ("A") REFERENCES "ChartExercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ChartExerciseToConcept_B_fkey" FOREIGN KEY ("B") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "_ChartExerciseToConcept_AB_unique" ON "_ChartExerciseToConcept"("A", "B");

-- CreateIndex
CREATE INDEX "_ChartExerciseToConcept_B_index" ON "_ChartExerciseToConcept"("B");
