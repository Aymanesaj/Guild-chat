
import { BadRequestError } from "../errors/bad-request.error.js";
import { UnauthorizedError } from "../errors/unauthorized.error.js";

import { findUserById } from "../repositories/user.repository.js";

import { registerAvatarUpload } from "../repositories/avatar-upload.repository.js";

import {
  createAvatarUpload,
} from "../clients/media.client.js";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function requestAvatarUpload(
  userId: string,
  contentType: string,
) {
  // 1. Ensure the user exists.
  const user = await findUserById(userId);

  if (!user) {
    throw new UnauthorizedError(
      "User not found",
    );
  }

  // 2. Validate the declared content type.
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new BadRequestError(
      "Unsupported avatar content type",
    );
  }

  // 3. Ask Media to create an upload session.
  const upload = await createAvatarUpload(
    userId,
    contentType,
  );

  // 4. Record ownership and revision in Identity.
  await registerAvatarUpload(
    userId,
    upload.uploadId,
  );

  // 5. Return instructions to the frontend.
  return {
    uploadId: upload.uploadId,
    uploadUrl: upload.uploadUrl,
    requiredContentType:
      upload.requiredContentType,
    expiresIn: upload.expiresIn,
  };
}
