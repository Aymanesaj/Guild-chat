import type {
  Friendship,
  FriendRequestResponse,
} from "../types/friendship.types.js";

export function toFriendRequestResponse(
  friendship: Friendship
): FriendRequestResponse {
  return {
    id: friendship.id,
    requesterId: friendship.requesterId,
    addresseeId: friendship.addresseeId,
    status: friendship.status,
    createdAt: friendship.createdAt,
    updatedAt: friendship.updatedAt,
  };
}