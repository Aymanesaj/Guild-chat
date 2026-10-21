import { prisma } from "../database/prisma.js";
import { deleteObject } from "../storage/r2.storage.js";

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