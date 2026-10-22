
import { NotFoundError } from "../errors/not-found.error.js";

import {
  findAvatarUploadForUser,
} from "../repositories/avatar-upload.repository.js";

import {
  getAvatarUploadStatus,
} from "../clients/media.client.js";

export async function getAvatarUploadProgress(
  userId: string,
  uploadId: string,
) {
  // Verify that this upload belongs to the user.
  const upload = await findAvatarUploadForUser(
    userId,
    uploadId,
  );

  if (!upload) {
    throw new NotFoundError(
      "Avatar upload not found",
    );
  }

  // Ask Media for the current processing status.
  const result = await getAvatarUploadStatus(
    uploadId,
    userId,
  );

  return {
    uploadId: result.uploadId,
    status: result.status,
    errorCode: result.errorCode,
    deletionPending: result.deletionPending,
  };
}
