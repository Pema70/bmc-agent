-- CreateEnum
CREATE TYPE "RefinementStatus" AS ENUM ('AWAITING_ANSWERS', 'PROPOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "refinementQuestionIndex" INTEGER,
ADD COLUMN     "refinementRoundId" TEXT;

-- CreateTable
CREATE TABLE "RefinementRound" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "variantVersion" INTEGER NOT NULL,
    "stateSnapshot" JSONB NOT NULL,
    "status" "RefinementStatus" NOT NULL DEFAULT 'AWAITING_ANSWERS',
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "result" JSONB,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "questionsPromptVersion" TEXT NOT NULL,
    "refinePromptVersion" TEXT,
    "questionsLlmCallLogId" TEXT,
    "refineLlmCallLogId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefinementRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefinementRound_questionsLlmCallLogId_key" ON "RefinementRound"("questionsLlmCallLogId");

-- CreateIndex
CREATE UNIQUE INDEX "RefinementRound_refineLlmCallLogId_key" ON "RefinementRound"("refineLlmCallLogId");

-- CreateIndex
CREATE INDEX "RefinementRound_projectId_idx" ON "RefinementRound"("projectId");

-- CreateIndex
CREATE INDEX "RefinementRound_evaluationId_idx" ON "RefinementRound"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "RefinementRound_variantId_roundNumber_key" ON "RefinementRound"("variantId", "roundNumber");

-- CreateIndex
CREATE INDEX "Proposal_refinementRoundId_idx" ON "Proposal"("refinementRoundId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_refinementRoundId_fkey" FOREIGN KEY ("refinementRoundId") REFERENCES "RefinementRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BmcVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationResult"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_questionsLlmCallLogId_fkey" FOREIGN KEY ("questionsLlmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_refineLlmCallLogId_fkey" FOREIGN KEY ("refineLlmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual (not known to Prisma, so it creates no schema drift): at most 3 refinement rounds per variant.
-- Every future migration must be checked for DROP CONSTRAINT "RefinementRound_roundNumber_check"
-- (and for DROP INDEX "BmcVariant_projectId_main_key").
ALTER TABLE "RefinementRound" ADD CONSTRAINT "RefinementRound_roundNumber_check" CHECK ("roundNumber" BETWEEN 1 AND 3);
