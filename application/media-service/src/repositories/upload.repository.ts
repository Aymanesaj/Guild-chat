import { randomUUID } from "node:crypto";
import { prisma } from "../database/prisma.js";
import type {
  CallerService,
  MediaPurpose,
} from "../media/media-policy.js";
import { createCandidateKey } from "../media/media-keys.js";

export const PROCESSING_LEASE_MS = 5 * 60 * 1000;

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
  const candidateKey = createCandidateKey(
    access.purpose,
    access.ownerId,
    access.uploadId,
    processingToken,
  );
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
      candidateKey,
      orphanCleanupAfter: null,
    },
  });

  return result.count === 1 ? processingToken : null;
}