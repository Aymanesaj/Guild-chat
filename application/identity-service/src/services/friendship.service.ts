import { BadRequestError } from "../errors/bad-request.error.js";
import { NotFoundError } from "../errors/not-found.error.js";
import { ConflictError } from "../errors/conflict.error.js";
import { ForbiddenError } from "../errors/forbidden.error.js";
import { findUserById } from "../repositories/user.repository.js";
import {
  createFriendRequest,
  findFriendshipBetween,
  findFriendRequestById,
  acceptFriendRequest as acceptFriendRequestInDb,
} from "../repositories/friendship.repository.js";
import { toFriendRequestResponse } from "../mappers/friendship.mapper.js";
import type { FriendRequestResponse } from "../types/friendship.types.js";

export async function sendFriendRequest(
  requesterId: string,
  addresseeId: string,
): Promise<FriendRequestResponse> {
  if (requesterId === addresseeId) {
    throw new BadRequestError("You cannot send a friend request to yourself");
  }

  const addressee = await findUserById(addresseeId);

  if (!addressee) {
    throw new NotFoundError("User not found");
  }

  const existingFriendship = await findFriendshipBetween(
    requesterId,
    addresseeId,
  );

  if (existingFriendship) {
    if (existingFriendship.status === "PENDING") {
      throw new ConflictError(
        "A friend request already exists between these users",
      );
    }

    if (existingFriendship.status === "ACCEPTED") {
      throw new ConflictError("Users are already friends");
    }
  }

  const friendship = await createFriendRequest(requesterId, addresseeId);

  return toFriendRequestResponse(friendship);
}

export async function acceptFriendRequest(
  userId: string,
  requestId: string,
): Promise<FriendRequestResponse> {
  const friendship = await findFriendRequestById(requestId);

  if (!friendship) {
    throw new NotFoundError("Friend request not found");
  }

  if (friendship.addresseeId !== userId) {
    throw new ForbiddenError(
      "You are not allowed to accept this friend request",
    );
  }

  if (friendship.status !== "PENDING") {
    throw new ConflictError("Friend request is not pending");
  }

  const accepted = await acceptFriendRequestInDb(requestId);

  return toFriendRequestResponse(accepted);
}
