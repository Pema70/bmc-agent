-- AlterEnum
ALTER TYPE "EvaluationSource" ADD VALUE 'JUDGE';

-- AlterEnum
ALTER TYPE "EvaluationTrigger" ADD VALUE 'SCRIPT';

-- AlterTable
ALTER TABLE "LlmCallLog" ADD COLUMN     "reasoningTokens" INTEGER;
