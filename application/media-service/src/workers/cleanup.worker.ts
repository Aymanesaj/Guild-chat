import { prisma } from "../database/prisma.js";
import { deleteObject } from "../storage/r2.storage.js";
import { PROCESSING_LEASE_MS } from "../repositories/upload.repository.js";

const BATCH_SIZE = 10;
const CLEANUP_INTERVAL_MS = 30_000;

// Delay source cleanup until after the upload URL expires.
const TEMP_CLEANUP_GRACE_MS = 60_000;

export async function cleanupUploads(): Promise<void> {
  const now = new Date();

  // Find a bounded batch of expired, unclaimed sessions.
  const expired = await prisma.mediaUpload.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
    },
    select: { id: true },
    take: BATCH_SIZE,
    orderBy: { expiresAt: "asc" },
  });

  for (const upload of expired) {
    // Recheck status atomically: finalization may have claimed it.
    await prisma.mediaUpload.updateMany({
      where: {
        id: upload.id,
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: {
        status: "EXPIRED",
        tempCleanupPending: true,
      },
    });
  }

  const pendingDeletes = await prisma.mediaUpload.findMany({
    where: {
      status: "READY",
      finalCleanupPending: true,
    },
    select: {
      id: true,
      finalKey: true,
    },
    take: BATCH_SIZE,
    orderBy: { updatedAt: "asc" },
  });

  for (const upload of pendingDeletes) {
    if (!upload.finalKey) {
      console.error("Media cleanup: final key is missing");
      continue;
    }

    try {
      await deleteObject(upload.finalKey);

      await prisma.mediaUpload.updateMany({
        where: {
          id: upload.id,
          status: "READY",
          finalCleanupPending: true,
          finalKey: upload.finalKey,
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          finalCleanupPending: false,
        },
      });
    } catch {
      // Keep the flag so a later run retries.
      console.error("Media cleanup: final deletion failed");
    }
  }

  const temporaryUploads = await prisma.mediaUpload.findMany({
    where: {
      status: {
        in: ["READY", "FAILED", "EXPIRED", "DELETED"],
      },
      tempCleanupPending: true,
      expiresAt: {
        lte: new Date(Date.now() - TEMP_CLEANUP_GRACE_MS),
      },
    },
    select: {
      id: true,
      temporaryKey: true,
    },
    take: BATCH_SIZE,
    orderBy: { expiresAt: "asc" },
  });

  for (const upload of temporaryUploads) {
    try {
      await deleteObject(upload.temporaryKey);

      await prisma.mediaUpload.updateMany({
        where: {
          id: upload.id,
          status: {
            in: ["READY", "FAILED", "EXPIRED", "DELETED"],
          },
          tempCleanupPending: true,
        },
        data: {
          tempCleanupPending: false,
        },
      });
    } catch {
      console.error("Media cleanup: temporary deletion failed");
    }
  }
  await failExpiredProcessing();
  await cleanupFailedCandidates();
}

export function startCleanupWorker() {
  let running: Promise<void> | null = null;

  function tick() {
    if (running) {
      return;
    }

    running = cleanupUploads()
      .catch(() => {
        console.error("Media cleanup: database or worker failure");
      })
      .finally(() => {
        running = null;
      });
  }

  const timer = setInterval(tick, CLEANUP_INTERVAL_MS);
  timer.unref();

  tick();

  return async function stopCleanupWorker() {
    clearInterval(timer);

    if (running) {
      await running;
    }
  };
}

async function failExpiredProcessing(): Promise<void> {
  const cutoff = new Date(Date.now() - PROCESSING_LEASE_MS);

  const stale = await prisma.mediaUpload.findMany({
    where: {
      status: "PROCESSING",
      processingStartedAt: { lte: cutoff },
    },
    select: {
      id: true,
      processingToken: true,
      candidateKey: true,
    },
    take: BATCH_SIZE,
    orderBy: { processingStartedAt: "asc" },
  });

  for (const upload of stale) {
    await prisma.mediaUpload.updateMany({
      where: {
        id: upload.id,
        status: "PROCESSING",
        processingToken: upload.processingToken,
        processingStartedAt: { lte: cutoff },
      },
      data: {
        status: "FAILED",
        errorCode: "PROCESSING_EXPIRED",
        processingToken: null,
        processingStartedAt: null,
        tempCleanupPending: true,
        finalCleanupPending: upload.candidateKey !== null,
        orphanCleanupAfter: new Date(),
      },
    });
  }
}

async function cleanupFailedCandidates(): Promise<void> {
  const now = new Date();

  const candidates = await prisma.mediaUpload.findMany({
    where: {
      status: "FAILED",
      finalCleanupPending: true,
      candidateKey: { not: null },
      orphanCleanupAfter: { lte: now },
    },
    select: {
      id: true,
      candidateKey: true,
    },
    take: BATCH_SIZE,
    orderBy: { orphanCleanupAfter: "asc" },
  });

  for (const upload of candidates) {
    if (!upload.candidateKey) {
      continue;
    }

    const claimed = await prisma.mediaUpload.updateMany({
      where: {
        id: upload.id,
        status: "FAILED",
        finalCleanupPending: true,
        candidateKey: upload.candidateKey,
        orphanCleanupAfter: { lte: now },
      },
      data: {
        orphanCleanupAfter: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    try {
      await deleteObject(upload.candidateKey);
    } catch {
      console.error("Media cleanup: orphan deletion failed");
    }

    // Retain tracking in case an expired worker writes the object later.
  }
}