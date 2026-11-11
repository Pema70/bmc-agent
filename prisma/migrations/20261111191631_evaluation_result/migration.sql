-- CreateEnum
CREATE TYPE "EvaluationSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "EvaluationTrigger" AS ENUM ('UI', 'CHAT');

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "variantVersion" INTEGER NOT NULL,
    "stateSnapshot" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "source" "EvaluationSource" NOT NULL DEFAULT 'AI',
    "trigger" "EvaluationTrigger",
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "llmCallLogId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_llmCallLogId_key" ON "EvaluationResult"("llmCallLogId");

-- CreateIndex
CREATE INDEX "EvaluationResult_variantId_createdAt_idx" ON "EvaluationResult"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationResult_projectId_idx" ON "EvaluationResult"("projectId");

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BmcVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_llmCallLogId_fkey" FOREIGN KEY ("llmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
