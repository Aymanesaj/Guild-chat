import { findUserById } from "../repositories/user.repository.js";

import {
  NotFoundError,
} from "../errors/not-found.error.js";

export async function getCurrentUser(
    userId: string
) {
    const user = await findUserById(userId);

    if (!user)
        return new NotFoundError("User not found");

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