
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
  deleteFriendshipById,
  findAcceptedFriendships,
  findPendingFriendRequests,
} from "../repositories/friendship.repository.js";

import { toFriendRequestResponse } from "../mappers/friendship.mapper.js";
import { toPublicProfile } from "../mappers/user.mapper.js";

import type {
  FriendRequestResponse,
  FriendRequestsResponse,
} from "../types/friendship.types.js";


import type { PublicProfile } from "../types/user.types.js";

import { publishFriendshipEvent } from "../messaging/friendship.publisher.js";
import type { FriendshipEventType } from "../messaging/friendship.events.js";

async function publishFriendshipEventSafely(
  eventType: FriendshipEventType,
  friendship: {
    id: string;
    requesterId: string;
    addresseeId: string;
  },
): Promise<void> {
  try {
    await publishFriendshipEvent(eventType, {
      friendshipId: friendship.id,
      requesterId: friendship.requesterId,
      addresseeId: friendship.addresseeId,
    });
  } catch (error) {
    // The database operation has already succeeded.
    // A RabbitMQ failure must not turn it into an HTTP failure.
    console.error(
      `Failed to publish ${eventType} for friendship ${friendship.id}`,
      error,
    );
  }
}

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

  let friendship;

  try {
    friendship = await createFriendRequest(
      requesterId,
      addresseeId,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new ConflictError(
        "A relationship already exists between these users",
      );
    }

    throw error;
  }

  // Publish only after successful database creation.
  await publishFriendshipEventSafely(
    "FRIEND_REQUEST_SENT",
    friendship,
  );

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

  // Only the recipient can accept the request.
  if (friendship.addresseeId !== userId) {
    throw new ForbiddenError(
      "You are not allowed to accept this friend request",
    );
  }

  if (friendship.status !== "PENDING") {
    throw new ConflictError(
      "Friend request is not pending",
    );
  }

  let accepted;

  try {
    // Repository must conditionally update PENDING -> ACCEPTED.
    accepted = await acceptFriendRequestInDb(requestId);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    ) {
      throw new ConflictError(
        "Friend request is no longer pending",
      );
    }

    throw error;
  }

  // Supports repository implementations returning null
  // when no pending friendship was updated.
  if (!accepted) {
    throw new ConflictError(
      "Friend request is no longer pending",
    );
  }

  // Only publish after a successful acceptance transition.
  await publishFriendshipEventSafely(
    "FRIEND_REQUEST_ACCEPTED",
    accepted,
  );

  return toFriendRequestResponse(accepted);
}

export async function declineFriendRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  const friendship = await findFriendRequestById(requestId);

  if (!friendship) {
    throw new NotFoundError("Friend request not found");
  }

  if (friendship.addresseeId !== userId) {
    throw new ForbiddenError(
      "You are not allowed to decline this friend request",
    );
  }

  if (friendship.status !== "PENDING") {
    throw new ConflictError("Friend request is not pending");
  }

  await deleteFriendshipById(requestId);
}

export async function removeFriend(
  userId: string,
  friendId: string,
): Promise<void> {
  if (userId === friendId) {
    throw new BadRequestError("You cannot remove yourself as a friend");
  }

  const friendship = await findFriendshipBetween(userId, friendId);

  if (!friendship) {
    throw new NotFoundError("Friendship not found");
  }

  await deleteFriendshipById(friendship.id);
}

export async function getFriends(userId: string): Promise<PublicProfile[]> {
  const friendships = await findAcceptedFriendships(userId);

  return friendships.map((friendship) => {
    const friend =
      friendship.requesterId === userId
        ? friendship.addressee
        : friendship.requester;

    return toPublicProfile(friend);
  });
}

export async function getFriendRequests(
  userId: string,
): Promise<FriendRequestsResponse> {
  const requests = await findPendingFriendRequests(userId);

  const incoming: FriendRequestResponse[] = [];
  const outgoing: FriendRequestResponse[] = [];

  for (const request of requests) {
    const response = toFriendRequestResponse(request);

    if (request.addresseeId === userId) {
      incoming.push(response);
    } else {
      outgoing.push(response);
    }
  }

  return {
    incoming,
    outgoing,
  };
}
