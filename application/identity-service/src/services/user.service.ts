import { findUserById, findUserByUsername } from "../repositories/user.repository.js";
import { UpdateProfileInput } from "../schemas/user.schema.js";
import { updateUserData , usernameExists , updateUserAvatar } from "../repositories/user.repository.js";
import { ConflictError } from "../errors/conflict.error.js";
import { PublicUser , PublicProfile } from "../types/user.types.js";
import { toPublicUser , toPublicProfile } from "../mappers/user.mapper.js";
import { unlink } from "node:fs/promises";
import { basename , join } from "node:path";
import { AVATAR_DIR } from "../constants/avatar.constants.js";
import {
  NotFoundError,
} from "../errors/not-found.error.js";

export async function getCurrentUser(
    userId: string
): Promise<PublicUser> {
    const user = await findUserById(userId);

    if (!user)
        throw new NotFoundError("User not found");

    return toPublicUser(user);
}

export async function updateCurrentUser(
    userId: string,
    input: UpdateProfileInput
): Promise<PublicUser> {
    const user = await findUserById(userId);

    if (!user)
        throw new NotFoundError("User Not found");

    if (input.username !== undefined && input.username !== user.username)
    {
        const taken = await findUserByUsername(input.username);

        if (taken)
            throw new ConflictError("Username is already taken");
    }

    const updatedUser = await updateUserData(userId, input);
    return toPublicUser(updatedUser);
}

export async function getUserById(
  userId: string
): Promise<PublicProfile> {
    const user =
        await findUserById(userId);

    if (!user) {
        throw new NotFoundError(
        "User not found"
        );
    }

    return toPublicProfile(user);
}

export async function checkUsernameAvailability(
  username: string
) {
  const exists = await usernameExists(username);

  if (exists) {
    return {
      available: false,
      message: "Username is already taken",
    };
  }

  return {
    available: true,
    message: "Username is available",
  };
}

export async function getUserByUsername(
  username: string
): Promise<PublicProfile> {
  const user =
    await findUserByUsername(username);

  if (!user) {
    throw new NotFoundError(
      "User not found"
    );
  }

  return toPublicProfile(user);
}

export async function deleteAvatar(
  userId: string
) {
    const user =
        await findUserById(userId);

    if (!user) {
        throw new NotFoundError(
        "User not found"
        );
    }

    if (!user.avatarUrl) {
        return toPublicUser(user);
    }

    const oldAvatarUrl = user.avatarUrl;

    const updatedUser = await updateUserAvatar(userId, null);
    if (oldAvatarUrl.startsWith("/avatars/")) {
        const filename = basename(oldAvatarUrl);

        const filepath = join(AVATAR_DIR, filename);
        await unlink(filepath).catch(() => {});
    }

    return toPublicUser(
        updatedUser
    );
}