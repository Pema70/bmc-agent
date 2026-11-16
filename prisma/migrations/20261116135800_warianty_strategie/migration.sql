-- CreateEnum
CREATE TYPE "VariantOrigin" AS ENUM ('MANUAL', 'AI_STRATEGY');

-- CreateEnum
CREATE TYPE "OperationTrigger" AS ENUM ('UI', 'CHAT');

-- AlterTable
ALTER TABLE "BmcVariant" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "generationId" TEXT,
ADD COLUMN     "generationIndex" INTEGER,
ADD COLUMN     "origin" "VariantOrigin" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "StrategyGeneration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "variantVersion" INTEGER NOT NULL,
    "stateSnapshot" JSONB NOT NULL,
    "guidelines" TEXT,
    "result" JSONB NOT NULL,
    "trigger" "OperationTrigger" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "llmCallLogId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyGeneration_llmCallLogId_key" ON "StrategyGeneration"("llmCallLogId");

-- CreateIndex
CREATE INDEX "StrategyGeneration_variantId_createdAt_idx" ON "StrategyGeneration"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyGeneration_projectId_idx" ON "StrategyGeneration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BmcVariant_generationId_generationIndex_key" ON "BmcVariant"("generationId", "generationIndex");

-- AddForeignKey
ALTER TABLE "BmcVariant" ADD CONSTRAINT "BmcVariant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BmcVariant" ADD CONSTRAINT "BmcVariant_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "StrategyGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyGeneration" ADD CONSTRAINT "StrategyGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyGeneration" ADD CONSTRAINT "StrategyGeneration_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BmcVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyGeneration" ADD CONSTRAINT "StrategyGeneration_llmCallLogId_fkey" FOREIGN KEY ("llmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyGeneration" ADD CONSTRAINT "StrategyGeneration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

