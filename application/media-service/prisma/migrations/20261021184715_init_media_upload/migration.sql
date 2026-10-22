-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('AVATAR', 'CHAT_IMAGE');

-- CreateEnum
CREATE TYPE "CallerService" AS ENUM ('IDENTITY', 'CHAT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED', 'DELETED');

-- CreateTable
CREATE TABLE "MediaUpload" (
    "id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "callerService" "CallerService" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "claimedContentType" TEXT NOT NULL,
    "temporaryKey" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "processingStartedAt" TIMESTAMP(3),
    "processingToken" UUID,
    "finalKey" TEXT,
    "finalContentType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "errorCode" TEXT,
    "tempCleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "finalCleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_temporaryKey_key" ON "MediaUpload"("temporaryKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_finalKey_key" ON "MediaUpload"("finalKey");

-- CreateIndex
CREATE INDEX "MediaUpload_status_expiresAt_idx" ON "MediaUpload"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MediaUpload_status_processingStartedAt_idx" ON "MediaUpload"("status", "processingStartedAt");

-- CreateIndex
CREATE INDEX "MediaUpload_callerService_ownerId_purpose_idx" ON "MediaUpload"("callerService", "ownerId", "purpose");
