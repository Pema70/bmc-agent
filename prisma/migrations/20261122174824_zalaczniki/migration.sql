-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PDF', 'DOCX', 'TXT');

-- CreateEnum
CREATE TYPE "ProposalSourceKind" AS ENUM ('CONVERSATION', 'ATTACHMENT', 'REFINEMENT', 'MODEL_KNOWLEDGE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "attachmentSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "sourceAttachmentId" TEXT,
ADD COLUMN     "sourceAttachmentName" TEXT,
ADD COLUMN     "sourceKind" "ProposalSourceKind" NOT NULL DEFAULT 'CONVERSATION';

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "textChars" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_projectId_createdAt_idx" ON "Attachment"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_projectId_ordinal_key" ON "Attachment"("projectId", "ordinal");

-- CreateIndex
CREATE INDEX "Proposal_sourceAttachmentId_idx" ON "Proposal"("sourceAttachmentId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sourceAttachmentId_fkey" FOREIGN KEY ("sourceAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
