
import { prisma } from "../database/prisma.js";

const CLAIM_LEASE_MS = 60_000;
const MAX_BATCH_SIZE = 20;

export async function claimAvatarCleanupJobs(
  limit = 10,
) {
  const now = new Date();

  const candidates = await prisma.avatarCleanupJob.findMany({
    where: {
      completedAt: null,
      nextRetryAt: {
        lte: now,
      },
    },
    orderBy: {
      nextRetryAt: "asc",
    },
    take: Math.max(1, Math.min(limit, MAX_BATCH_SIZE)),
  });

  const claimed = [];

  for (const job of candidates) {
    // Claim only if the job has not changed
    // since it was read.
    const result = await prisma.avatarCleanupJob.updateMany({
      where: {
        id: job.id,
        completedAt: null,
        nextRetryAt: job.nextRetryAt,
      },
      data: {
        attempts: {
          increment: 1,
        },
        nextRetryAt: new Date(
          Date.now() + CLAIM_LEASE_MS,
        ),
      },
    });

    if (result.count !== 1) {
      continue;
    }

    const updated = await prisma.avatarCleanupJob.findUnique({
      where: {
        id: job.id,
      },
    });

    if (updated) {
      claimed.push(updated);
    }
  }

  return claimed;
}

export async function completeAvatarCleanupJob(
  jobId: string,
  claimedAttempt: number,
) {
  return prisma.avatarCleanupJob.updateMany({
    where: {
      id: jobId,
      attempts: claimedAttempt,
      completedAt: null,
    },
    data: {
      completedAt: new Date(),
    },
  });
}

export async function retryAvatarCleanupJob(
  jobId: string,
  claimedAttempt: number,
) {
  const delaySeconds = Math.min(
    60 * 60,
    2 ** Math.min(claimedAttempt, 10) * 5,
  );

  return prisma.avatarCleanupJob.updateMany({
    where: {
      id: jobId,
      attempts: claimedAttempt,
      completedAt: null,
    },
    data: {
      nextRetryAt: new Date(
        Date.now() + delaySeconds * 1000,
      ),
    },
  });
}

export async function findActiveAvatarReference(
  userId: string,
) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      avatarMediaId: true,
    },
  });
}
