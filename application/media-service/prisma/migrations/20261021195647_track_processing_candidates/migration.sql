/*
  Warnings:

  - A unique constraint covering the columns `[candidateKey]` on the table `MediaUpload` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MediaUpload" ADD COLUMN     "candidateKey" TEXT,
ADD COLUMN     "orphanCleanupAfter" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_candidateKey_key" ON "MediaUpload"("candidateKey");

-- CreateIndex
CREATE INDEX "MediaUpload_status_finalCleanupPending_orphanCleanupAfter_idx" ON "MediaUpload"("status", "finalCleanupPending", "orphanCleanupAfter");
