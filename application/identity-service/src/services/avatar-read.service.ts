
import { NotFoundError } from "../errors/not-found.error.js";

import {
  findUserAvatarById,
} from "../repositories/user.repository.js";

import {
  getAvatarDownloadUrl,
} from "../clients/media.client.js";

export async function getUserAvatarUrl(
  targetUserId: string,
) {
  const user = await findUserAvatarById(targetUserId);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (!user.avatarMediaId) {
    return null;
  }

  const download = await getAvatarDownloadUrl(
    user.avatarMediaId,
    user.id,
  );

  return {
    mediaId: download.mediaId,
    downloadUrl: download.downloadUrl,
    contentType: download.contentType,
    expiresIn: download.expiresIn,
  };
}
