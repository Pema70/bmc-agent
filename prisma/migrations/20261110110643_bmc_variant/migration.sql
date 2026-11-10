-- CreateTable
CREATE TABLE "BmcVariant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BmcVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BmcVariant_projectId_idx" ON "BmcVariant"("projectId");

-- CreateIndex (dopisane ręcznie, D2): najwyżej jeden wariant główny na projekt.
CREATE UNIQUE INDEX "BmcVariant_projectId_main_key" ON "BmcVariant"("projectId") WHERE "isMain";

-- AddForeignKey
ALTER TABLE "BmcVariant" ADD CONSTRAINT "BmcVariant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
