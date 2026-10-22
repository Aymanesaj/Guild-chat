import { prisma } from "../database/prisma.js";

import {
  createPresignedUploadUrl,
  deleteObject,
  downloadObject,
  getObjectInfo,
  uploadWebp,
  UPLOAD_URL_TTL_SECONDS,
  createPresignedDownloadUrl,
  DOWNLOAD_URL_TTL_SECONDS,
} from "../storage/r2.storage.js";

import {
  createCandidateKey,
  createMediaKeys,
} from "./media-keys.js";

import {
  getMaxUploadBytes,
  validateUploadRequest,
} from "./media-policy.js";

import type {
  CallerService,
  MediaPurpose,
} from "./media-policy.js";

import { withFinalizationSlot } from "./finalization-limit.js";

import {
  ImageProcessorBusyError,
  processImage,
} from "../processors/image.processor.js";

import {
  claimUpload,
  findUpload,
  PROCESSING_LEASE_MS,
} from "../repositories/upload.repository.js";

interface CreateUploadInput {
  ownerId: string;
  purpose: MediaPurpose;
  contentType: string;
}

interface FinalizeUploadInput {
  uploadId: string;
  ownerId: string;
  purpose: MediaPurpose;
}

interface DeleteMediaInput {
  mediaId: string;
  ownerId: string;
  purpose: MediaPurpose;
}

interface GetDownloadUrlInput {
  mediaId: string;
  ownerId: string;
  purpose: MediaPurpose;
}

export async function getDownloadUrl(
  caller: CallerService,
  input: GetDownloadUrlInput,
) {
  const upload = await findUpload({
    uploadId: input.mediaId,
    ownerId: input.ownerId,
    purpose: input.purpose,
    caller,
  });

  if (!upload) {
    throw new Error("Media not found");
  }

  if (
    upload.status !== "READY" ||
    !upload.finalKey ||
    upload.finalCleanupPending
  ) {
    throw new Error("Media is not available for download");
  }

  const downloadUrl = await createPresignedDownloadUrl(
    upload.finalKey,
  );

  return {
    mediaId: upload.id,
    downloadUrl,
    contentType: "image/webp" as const,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  };
}

export async function createUpload(
  caller: CallerService,
  input: CreateUploadInput,
) {
  const contentType = validateUploadRequest(
    caller,
    input.purpose,
    input.contentType,
  );

  const { id, temporaryKey } = createMediaKeys(
    input.purpose,
    input.ownerId,
  );

  const expiresAt = new Date(
    Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
  );

  const uploadUrl = await createPresignedUploadUrl(
    temporaryKey,
    contentType,
  );

  await prisma.mediaUpload.create({
    data: {
      id,
      purpose: input.purpose,
      callerService: caller,
      ownerId: input.ownerId,
      claimedContentType: contentType,
      temporaryKey,
      status: "PENDING",
      expiresAt,
    },
  });

  return {
    uploadId: id,
    uploadUrl,
    requiredContentType: contentType,
    expiresIn: Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    ),
  };
}

export async function finalizeUpload(
  caller: CallerService,
  input: FinalizeUploadInput,
) {
  return withFinalizationSlot(() =>
    finalizeUploadInternal(caller, input),
  );
}

async function finalizeUploadInternal(
  caller: CallerService,
  input: FinalizeUploadInput,
) {
  const access = {
    ...input,
    caller,
  };

  const upload = await findUpload(access);

  if (!upload) {
    throw new Error("Upload not found");
  }

  const temporaryKey = upload.temporaryKey;

  // Return the original result when finalization already succeeded.
  if (upload.status === "READY") {
    if (upload.finalCleanupPending) {
      throw new Error("Media is pending deletion");
    }

    if (
      !upload.finalKey ||
      !upload.finalContentType ||
      upload.width === null ||
      upload.height === null
    ) {
      throw new Error("Ready upload has incomplete metadata");
    }

    return {
      mediaId: upload.id,
      finalKey: upload.finalKey,
      contentType: upload.finalContentType,
      width: upload.width,
      height: upload.height,
      status: "READY" as const,
    };
  }

  if (upload.status !== "PENDING") {
    throw new Error(`Upload is ${upload.status}`);
  }

  if (upload.expiresAt <= new Date()) {
    throw new Error("Upload has expired");
  }

  const processingToken = await claimUpload(access);

  if (!processingToken) {
    throw new Error("Upload state changed; retry the request");
  }

  // Only this processing attempt may update the claimed upload.
  const processingWhere = {
    id: upload.id,
    status: "PROCESSING" as const,
    processingToken,
  };

  async function rejectUpload(errorCode: string) {
    const result = await prisma.mediaUpload.updateMany({
      where: processingWhere,
      data: {
        status: "FAILED",
        errorCode,
        tempCleanupPending: true,
        processingToken: null,
        processingStartedAt: null,
      },
    });

    if (result.count === 1) {
      await cleanupTemporaryObject(temporaryKey);
    }
  }

  const maxBytes = getMaxUploadBytes(upload.purpose);

  const object = await getObjectInfo(temporaryKey);

  if (
    object.sizeBytes !== undefined &&
    object.sizeBytes > maxBytes
  ) {
    await rejectUpload("IMAGE_TOO_LARGE");
    throw new Error("Image exceeds the upload size limit");
  }

  const source = await downloadObject(temporaryKey, maxBytes);

  let processed: Awaited<ReturnType<typeof processImage>>;

  try {
    processed = await processImage(source, upload.purpose);
  } catch (error) {
    if (error instanceof ImageProcessorBusyError) {
      // No final object has been written, so another attempt is safe.
      await prisma.mediaUpload.updateMany({
        where: processingWhere,
        data: {
          status: "PENDING",
          processingToken: null,
          processingStartedAt: null,
        },
      });
    } else {
      await rejectUpload("IMAGE_PROCESSING_FAILED");
    }

    throw error;
  }

  // Must match the candidateKey recorded by claimUpload().
  const finalKey = createCandidateKey(
    upload.purpose,
    upload.ownerId,
    upload.id,
    processingToken,
  );

  await uploadWebp(finalKey, processed.buffer);

  const saved = await prisma.mediaUpload.updateMany({
    where: {
      ...processingWhere,

      // An expired attempt must not publish its result.
      processingStartedAt: {
        gt: new Date(Date.now() - PROCESSING_LEASE_MS),
      },
    },
    data: {
      status: "READY",
      finalKey,
      finalContentType: processed.contentType,
      width: processed.width,
      height: processed.height,
      sizeBytes: processed.sizeBytes,
      completedAt: new Date(),
      processingToken: null,
      processingStartedAt: null,
      tempCleanupPending: true,
      errorCode: null,
    },
  });

  if (saved.count !== 1) {
    // Recovery tracks candidateKey and can remove the orphan.
    throw new Error("Upload processing ownership was lost");
  }

  await cleanupTemporaryObject(temporaryKey);

  return {
    mediaId: upload.id,
    finalKey,
    contentType: processed.contentType,
    width: processed.width,
    height: processed.height,
    status: "READY" as const,
  };
}

export async function deleteMedia(
  caller: CallerService,
  input: DeleteMediaInput,
) {
  const access = {
    uploadId: input.mediaId,
    ownerId: input.ownerId,
    purpose: input.purpose,
    caller,
  };

  const upload = await findUpload(access);

  if (!upload) {
    throw new Error("Media not found");
  }

  if (upload.status === "DELETED") {
    return {
      mediaId: upload.id,
      status: "DELETED" as const,
    };
  }

  if (upload.status !== "READY" || !upload.finalKey) {
    throw new Error("Only ready media can be deleted");
  }

  const finalKey = upload.finalKey;

  // Persist deletion intent before contacting R2.
  const marked = await prisma.mediaUpload.updateMany({
    where: {
      id: upload.id,
      ownerId: input.ownerId,
      callerService: caller,
      purpose: input.purpose,
      status: "READY",
      finalKey,
    },
    data: {
      finalCleanupPending: true,
    },
  });

  if (marked.count !== 1) {
    const current = await findUpload(access);

    if (current?.status === "DELETED") {
      return {
        mediaId: upload.id,
        status: "DELETED" as const,
      };
    }

    throw new Error("Media state changed; retry deletion");
  }

  // On failure, the persisted cleanup flag allows retries.
  await deleteObject(finalKey);

  const deleted = await prisma.mediaUpload.updateMany({
    where: {
      id: upload.id,
      status: "READY",
      finalKey,
      finalCleanupPending: true,
    },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
      finalCleanupPending: false,
    },
  });

  if (deleted.count !== 1) {
    const current = await findUpload(access);

    if (current?.status !== "DELETED") {
      throw new Error("Could not confirm deletion; retry");
    }
  }

  return {
    mediaId: upload.id,
    status: "DELETED" as const,
  };
}

async function cleanupTemporaryObject(
  temporaryKey: string,
): Promise<void> {
  try {
    await deleteObject(temporaryKey);
  } catch {
    console.error("Media cleanup: immediate source deletion failed");
  }

  // Keep tempCleanupPending true. The worker deletes again after
  // URL expiry because the presigned PUT can recreate the source.
}