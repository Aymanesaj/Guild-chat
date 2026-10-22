
import { ConflictError } from "../errors/conflict.error.js";
import {
  findAvatarUploadForUser,
  publishAvatarUpload,
} from "../repositories/avatar-upload.repository.js";
import {
  finalizeAvatarUpload,
  getAvatarDownloadUrl,
} from "../clients/media.client.js";
import {
  markObsoleteAvatarUpload,
} from "../repositories/avatar-upload.repository.js";

export async function confirmAvatarUpload(
  userId: string,
  uploadId: string,
) {
  // 1. Verify ownership in Identity.
  const upload = await findAvatarUploadForUser(
    userId,
    uploadId,
  );

  if (!upload) {
    throw new ConflictError(
      "Avatar upload not found",
    );
  }

  if (
    upload.status !== "PENDING" &&
    upload.status !== "PUBLISHED"
  ) {
    throw new ConflictError(
      "Avatar upload is no longer available",
    );
  }

  // 2. Ask Media to validate and process the image.
  // FinalizeUpload can be called again after success.
  const media = await finalizeAvatarUpload(
    uploadId,
    userId,
  );

  if (media.mediaId !== uploadId) {
    throw new ConflictError(
        "Media returned an unexpected avatar ID",
    );
}

  if (
    media.status === "PROCESSING" ||
    media.status === "PENDING"
  ) {
    throw new ConflictError(
      "Avatar processing is not finished",
    );
  }

  if (media.status !== "READY") {
    throw new ConflictError(
      "Avatar upload cannot be published",
    );
  }

  // 3. Atomically publish the avatar in Identity.
  
let publication: Awaited<
  ReturnType<typeof publishAvatarUpload>
>;

try {
  publication = await publishAvatarUpload(
    userId,
    uploadId,
  );
} catch (error) {
  // Only reconcile a known revision conflict.
  // Do not assume that arbitrary database errors
  // mean the publication was rolled back.
  if (
    error instanceof ConflictError &&
    error.message === "A newer avatar selection exists"
  ) {
    await markObsoleteAvatarUpload(
      userId,
      uploadId,
    );
  }

  throw error;
}



  if (publication.status === "STALE") {
    throw new ConflictError(
      "A newer avatar selection exists",
    );
  }

  // 4. The avatar is now official.
  // A signing failure must not undo the database commit.
  const download = await getAvatarDownloadUrl(
    media.mediaId,
    userId,
  );

  return {
    mediaId: media.mediaId,
    downloadUrl: download.downloadUrl,
    contentType: media.contentType,
    width: media.width,
    height: media.height,
    expiresIn: download.expiresIn,
  };
}
