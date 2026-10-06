import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { BadRequestError } from "../errors/bad-request.error.js";
import { NotFoundError } from "../errors/not-found.error.js";
import { findUserById , updateUserAvatar } from "../repositories/user.repository.js";
import { ALLOWED_AVATAR_TYPES , AVATAR_MIME_BY_EXTENSION , AVATAR_DIR } from "../constants/avatar.constants.js";
import { stat } from "node:fs/promises";
import { toPublicUser } from "../mappers/user.mapper.js";

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

    return toPublicUser(updatedUser);
}


export async function getAvatarFile(
    filename: string
) {
    if (basename(filename) !== filename)
        throw new NotFoundError("Avatar not found");

    const extension = extname(filename).slice(1).toLowerCase();

    const mimetype = AVATAR_MIME_BY_EXTENSION[extension];

    if (!mimetype)
        throw new NotFoundError("Avatar not found");

    const filepath = join(AVATAR_DIR, filename);

    let fileInfo;

    try {
        fileInfo = await stat(filepath);
    } catch (error) {
        throw new NotFoundError("Avatar not found");
    }

    if (!fileInfo.isFile())
        throw new NotFoundError("Avatar not found");

    return {
        filepath,
        mimetype
    };
}
