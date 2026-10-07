import { prisma } from "../database/prisma.js";
import { createFriendshipPairKey } from "../utils/friendship.util.js";

export function findFriendshipBetween(userA: string, userB: string) {
  const pairKey = createFriendshipPairKey(userA, userB);

  return prisma.friendship.findUnique({
    where: {
      pairKey,
    },
  });
}

export function createFriendRequest(requesterId: string, addresseeId: string) {
  const pairKey = createFriendshipPairKey(requesterId, addresseeId);

  return prisma.friendship.create({
    data: {
      requesterId,
      addresseeId,
      pairKey,
      status: "PENDING",
    },
  });
}

export function findFriendRequestById(id: string) {
  return prisma.friendship.findUnique({
    where: {
      id,
    },
  });
}

export function acceptFriendRequest(id: string) {
  return prisma.friendship.update({
    where: {
      id,
    },
    data: {
      status: "ACCEPTED",
    },
  });
}

export function deleteFriendshipById(id: string) {
  return prisma.friendship.delete({
    where: {
      id,
    },
  });
}
