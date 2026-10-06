import { findUserById, findUserByUsername } from "../repositories/user.repository.js";
import { UpdateProfileInput } from "../schemas/user.schema.js";
import { updateUserData } from "../repositories/user.repository.js";
import { ConflictError } from "../errors/conflict.error.js";
import { PublicUser } from "../types/user.types.js";
import { toPublicUser } from "../mappers/user.mapper.js";

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
): Promise<PublicUser> {
    const user =
        await findUserById(userId);

    if (!user) {
        throw new NotFoundError(
        "User not found"
        );
    }

    return toPublicUser(user);
}