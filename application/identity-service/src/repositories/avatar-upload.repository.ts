import { prisma } from "../database/prisma.js";
import { NotFoundError } from "../errors/not-found.error.js";
import { ConflictError } from "../errors/conflict.error.js";


export async function markObsoleteAvatarUpload(
  userId: string,
  uploadId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Lock the user's row while reconciling the upload.
    // This prevents concurrent avatar revision updates
    // from completing until this transaction finishes.
    await tx.user.updateMany({
      where: { id: userId },
      data: {
        avatarRevision: { increment: 0 },
      },
    });

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        avatarRevision: true,
        avatarMediaId: true,
      },
    });

    const upload = await tx.avatarUpload.findFirst({
      where: {
        id: uploadId,
        userId,
      },
    });

    if (!user || !upload) {
      return false;
    }

    // Never queue deletion of the active avatar.
    if (user.avatarMediaId === uploadId) {
      return false;
    }

    // Only uploads superseded by a newer revision
    // are eligible for stale cleanup.
    if (upload.revision >= user.avatarRevision) {
      return false;
    }

    // Transition exactly once from PENDING to STALE.
    const result = await tx.avatarUpload.updateMany({
      where: {
        id: uploadId,
        userId,
        revision: upload.revision,
        status: "PENDING",
      },
      data: {
        status: "STALE",
      },
    });

    if (result.count !== 1) {
      return false;
    }

    // Queue cleanup in the same transaction.
    await tx.avatarCleanupJob.create({
      data: {
        userId,
        mediaId: uploadId,
      },
    });

    return true;
  });
}

export async function registerAvatarUpload(
  userId: string,
  uploadId: string,
) {
  return prisma.$transaction(async (tx) => {
    // Increment the user's avatar revision.
    const user = await tx.user.update({
      where: {
        id: userId,
      },
      data: {
        avatarRevision: {
          increment: 1,
        },
      },
      select: {
        avatarRevision: true,
      },
    });

    // Associate the Media upload session with this user.
    const upload = await tx.avatarUpload.create({
      data: {
        id: uploadId,
        userId,
        revision: user.avatarRevision,
        status: "PENDING",
      },
    });

    return upload;
  });
}

// Keep your existing prisma import and registerAvatarUpload().

// Find an upload only if it belongs to this user.
export function findAvatarUploadForUser(
  userId: string,
  uploadId: string,
) {
  return prisma.avatarUpload.findFirst({
    where: {
      id: uploadId,
      userId,
    },
  });
}

export async function publishAvatarUpload(
  userId: string,
  uploadId: string,
) {
  return prisma.$transaction(async (tx) => {
    // Re-read the upload inside the transaction.
    const upload = await tx.avatarUpload.findFirst({
      where: {
        id: uploadId,
        userId,
      },
    });

    if (!upload) {
      throw new ConflictError("Upload not found");
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        avatarMediaId: true,
        avatarRevision: true,
      },
    });

    if (!user) {
      throw new ConflictError("User not found");
    }

    // An already published upload is idempotent
    // only while it remains the current avatar.
    if (upload.status === "PUBLISHED") {
      if (user.avatarMediaId === uploadId) {
        return { status: "PUBLISHED" as const };
      }

      throw new ConflictError(
        "This avatar has already been replaced",
      );
    }

    if (upload.status !== "PENDING") {
      throw new ConflictError(
        "Upload is no longer available",
      );
    }

    // Older selections must not overwrite newer ones.
    if (upload.revision !== user.avatarRevision) {
      const stale = await tx.avatarUpload.updateMany({
        where: {
          id: uploadId,
          userId,
          status: "PENDING",
        },
        data: {
          status: "STALE",
        },
      });

      if (stale.count !== 1) {
        throw new ConflictError(
          "Upload state changed",
        );
      }

      // Finalization has already succeeded in Media,
      // but this image must not become the avatar.
      await tx.avatarCleanupJob.create({
        data: {
          userId,
          mediaId: uploadId,
        },
      });

      return { status: "STALE" as const };
    }

    // Claim this upload so concurrent confirmations
    // cannot both publish it.
    const claimed = await tx.avatarUpload.updateMany({
      where: {
        id: uploadId,
        userId,
        status: "PENDING",
      },
      data: {
        status: "PUBLISHED",
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictError(
        "Upload was already processed",
      );
    }

    // Update only if the selected revision is
    // still the user's latest revision.
    const updated = await tx.user.updateMany({
      where: {
        id: userId,
        avatarRevision: upload.revision,
      },
      data: {
        avatarMediaId: uploadId,
      },
    });

    if (updated.count !== 1) {
      // Throwing rolls back the entire transaction,
      // including the PUBLISHED status update.
      throw new ConflictError(
        "A newer avatar selection exists",
      );
    }

    // Queue deletion of the previous avatar.
    if (
      user.avatarMediaId &&
      user.avatarMediaId !== uploadId
    ) {
      await tx.avatarCleanupJob.create({
        data: {
          userId,
          mediaId: user.avatarMediaId,
        },
      });
    }

    return { status: "PUBLISHED" as const };
  });
}



export async function removeCurrentAvatar(
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock the user's row before reading it. Otherwise a confirmation
    // committing between our read and our update publishes an avatar we
    // never saw: we would clear it without queueing its cleanup.
    await tx.user.updateMany({
      where: { id: userId },
      data: {
        avatarRevision: { increment: 0 },
      },
    });

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        avatarMediaId: true,
        avatarRevision: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // A conditional update protects against concurrent
    // avatar confirmation or another deletion.
    const result = await tx.user.updateMany({
      where: {
        id: userId,
        avatarRevision: user.avatarRevision,
      },
      data: {
        avatarMediaId: null,
        avatarRevision: {
          increment: 1,
        },
      },
    });

    if (result.count !== 1) {
      throw new ConflictError(
        "Avatar changed during deletion; please retry",
      );
    }

    // Persist cleanup in the same transaction.
    // Never delete the file before removing its reference.
    if (user.avatarMediaId) {
      await tx.avatarCleanupJob.create({
        data: {
          userId,
          mediaId: user.avatarMediaId,
        },
      });
    }
  });
}
