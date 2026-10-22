
import {
  removeCurrentAvatar,
} from "../repositories/avatar-upload.repository.js";

export async function deleteCurrentAvatar(
  userId: string,
): Promise<void> {
  await removeCurrentAvatar(userId);
}
