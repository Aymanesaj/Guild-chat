import { findUserById, findUserByUsername } from "../repositories/user.repository.js";
import { UpdateProfileInput } from "../schemas/user.schema.js";
import { updateUserData } from "../repositories/user.repository.js";
import { ConflictError } from "../errors/conflict.error.js";
import { PublicUser } from "../types/auth.types.js";

import {
  NotFoundError,
} from "../errors/not-found.error.js";

export async function getCurrentUser(
    userId: string
): Promise<PublicUser> {
    const user = await findUserById(userId);

    if (!user)
        throw new NotFoundError("User not found");

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        authProvider: user.authProvider,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
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
    return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        bio: updatedUser.bio,
        avatarUrl: updatedUser.avatarUrl,
        authProvider: updatedUser.authProvider,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
    };
}