-- CreateEnum
CREATE TYPE "ImpactChangeKind" AS ENUM ('PROPOSAL', 'DESCRIPTION');

-- CreateEnum
CREATE TYPE "ImpactTrigger" AS ENUM ('UI', 'CHAT');

-- CreateTable
CREATE TABLE "ImpactAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "variantVersion" INTEGER NOT NULL,
    "stateSnapshot" JSONB NOT NULL,
    "changeKind" "ImpactChangeKind" NOT NULL,
    "proposalId" TEXT,
    "change" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "trigger" "ImpactTrigger" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "llmCallLogId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImpactAnalysis_llmCallLogId_key" ON "ImpactAnalysis"("llmCallLogId");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_variantId_createdAt_idx" ON "ImpactAnalysis"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_projectId_idx" ON "ImpactAnalysis"("projectId");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_proposalId_idx" ON "ImpactAnalysis"("proposalId");

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BmcVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_llmCallLogId_fkey" FOREIGN KEY ("llmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
