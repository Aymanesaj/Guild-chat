import { randomUUID } from "node:crypto";
import { prisma } from "../database/prisma.js";
import type {
  CallerService,
  MediaPurpose,
} from "../media/media-policy.js";

interface UploadAccess {
  uploadId: string;
  ownerId: string;
  caller: CallerService;
  purpose: MediaPurpose;
}

export async function findUpload(access: UploadAccess) {
  return prisma.mediaUpload.findFirst({
    where: {
      id: access.uploadId,
      ownerId: access.ownerId,
      callerService: access.caller,
      purpose: access.purpose,
    },
  });
}

export async function claimUpload(
  access: UploadAccess,
): Promise<string | null> {
  const processingToken = randomUUID();
  const now = new Date();

  const result = await prisma.mediaUpload.updateMany({
    where: {
      id: access.uploadId,
      ownerId: access.ownerId,
      callerService: access.caller,
      purpose: access.purpose,
      status: "PENDING",
      expiresAt: {
        gt: now,
      },
    },
    data: {
      status: "PROCESSING",
      processingToken,
      processingStartedAt: now,
      errorCode: null,
    },
  });

  return result.count === 1 ? processingToken : null;
}