-- CreateEnum
CREATE TYPE "EvalKind" AS ENUM ('BUILD', 'EVAL', 'CHAT');

-- CreateEnum
CREATE TYPE "EvalArchitecture" AS ENUM ('SINGLE', 'MULTI');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED', 'INVALID', 'STOPPED');

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "EvalKind" NOT NULL,
    "repetition" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "architecture" "EvalArchitecture" NOT NULL DEFAULT 'SINGLE',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "judgeModel" TEXT,
    "chatPromptVersion" TEXT NOT NULL,
    "casesChecksum" TEXT NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "maxOutputTokensLong" INTEGER NOT NULL,
    "costLimitUsd" DECIMAL(12,6) NOT NULL,
    "turnLimit" INTEGER NOT NULL,
    "projectId" TEXT,
    "status" "EvalRunStatus" NOT NULL,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvalRun_seriesId_caseId_idx" ON "EvalRun"("seriesId", "caseId");

-- CreateIndex
CREATE INDEX "EvalRun_projectId_idx" ON "EvalRun"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalRun_seriesId_caseId_model_repetition_architecture_attem_key" ON "EvalRun"("seriesId", "caseId", "model", "repetition", "architecture", "attempt");

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
