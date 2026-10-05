import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BadRequestError } from "../errors/bad-request.error.js";
import { NotFoundError } from "../errors/not-found.error.js";
import { findUserById , updateUserAvatar } from "../repositories/user.repository.js";
import { ALLOWED_AVATAR_TYPES } from "../constants/avatar.constants.js";
const AVATAR_DIR = process.env.AVATAR_DIR ?? "/tmp/identity-avatars";

export interface AvatarFile {
  mimetype: string;
  buffer: Buffer;
}

export async function saveAvatar(
    userId: string,
    file: AvatarFile
) {
    const user = await findUserById(userId);

    if (!user) {
        throw new NotFoundError("User not found");
    }

    const extension = ALLOWED_AVATAR_TYPES[file.mimetype];

    if (!extension) {
        throw new BadRequestError("Unsupported avatar format");
    }

    await mkdir(AVATAR_DIR, {
        recursive: true,
    });

    const filename = `${randomUUID()}.${extension}`;

    const filepath = join(AVATAR_DIR, filename);

    await writeFile(filepath, file.buffer);

    const avatarUrl = `/avatars/${filename}`;

    const updatedUser = await updateUserAvatar(userId, avatarUrl);

    return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        bio: updatedUser.bio,
        avatarUrl: updatedUser.avatarUrl,
        authProvider: updatedUser.authProvider,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
    };
}
