-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_media_id" UUID,
ADD COLUMN     "avatar_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "avatar_uploads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_cleanup_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_cleanup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatar_uploads_user_id_status_idx" ON "avatar_uploads"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_uploads_user_id_revision_key" ON "avatar_uploads"("user_id", "revision");

-- CreateIndex
CREATE INDEX "avatar_cleanup_jobs_completed_at_next_retry_at_idx" ON "avatar_cleanup_jobs"("completed_at", "next_retry_at");

-- AddForeignKey
ALTER TABLE "avatar_uploads" ADD CONSTRAINT "avatar_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_cleanup_jobs" ADD CONSTRAINT "avatar_cleanup_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
