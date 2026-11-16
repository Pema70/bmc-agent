-- CreateTable
CREATE TABLE "VariantComparison" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "trigger" "OperationTrigger" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "llmCallLogId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VariantComparison_llmCallLogId_key" ON "VariantComparison"("llmCallLogId");

-- CreateIndex
CREATE INDEX "VariantComparison_projectId_createdAt_idx" ON "VariantComparison"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "VariantComparison" ADD CONSTRAINT "VariantComparison_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantComparison" ADD CONSTRAINT "VariantComparison_llmCallLogId_fkey" FOREIGN KEY ("llmCallLogId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantComparison" ADD CONSTRAINT "VariantComparison_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

