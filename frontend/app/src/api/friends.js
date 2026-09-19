import { jsonBody, request } from "./http";
import { normalizeUser, rememberUser, resolveUsers } from "./users";

// identity-service's /friends, reached through the gateway's /api/users/ prefix.
const FRIENDS = "/api/users/friends";

/** identity has no paging here yet, so limit/offset are applied client-side. */
function page(items, { limit, offset = 0 } = {}) {
  return limit ? items.slice(offset, offset + limit) : items.slice(offset);
}

async function listPending() {
  // -> { incoming: FriendRequest[], outgoing: FriendRequest[] }
  const data = await request(`${FRIENDS}/requests`, {}, "Failed to fetch friend requests");
  return { incoming: data?.incoming ?? [], outgoing: data?.outgoing ?? [] };
}

export async function getFriendsList(options) {
  const friends = await request(FRIENDS, {}, "Failed to fetch friends");
  return page((friends || []).map((friend) => rememberUser(normalizeUser(friend))), options);
}

/** Incoming requests, shaped as { friendship_id, sender } like the UI expects. */
export async function getFriendRequests(options) {
  const { incoming } = await listPending();
  const senders = await resolveUsers(incoming.map((item) => item.requesterId));

  const requests = incoming.map((item) => ({
    friendship_id: item.id,
    sender: senders.get(item.requesterId) ?? null,
    created_at: item.createdAt,
  }));

  return page(requests, options);
}

/** Requests you sent that are still pending, shaped as { friendship_id, receiver }. */
export async function getSentFriendRequests(options) {
  const { outgoing } = await listPending();
  const receivers = await resolveUsers(outgoing.map((item) => item.addresseeId));

  const requests = outgoing.map((item) => ({
    friendship_id: item.id,
    receiver: receivers.get(item.addresseeId) ?? null,
    created_at: item.createdAt,
  }));

  return page(requests, options);
}

/**
 * Where the current user stands with `userId`. identity doesn't embed this on
 * the user object, so it's derived from the friends + pending lists.
 * -> { friendship_status: "none" | "pending_outgoing" | "pending_incoming" | "friends",
 *      friendship_id: string | null }
 */
export async function getFriendshipStatus(userId) {
  const [friends, { incoming, outgoing }] = await Promise.all([
    request(FRIENDS, {}, "Failed to fetch friends"),
    listPending(),
  ]);

  if ((friends || []).some((friend) => friend.id === userId)) {
    return { friendship_status: "friends", friendship_id: null };
  }

  const sent = outgoing.find((item) => item.addresseeId === userId);
  if (sent) return { friendship_status: "pending_outgoing", friendship_id: sent.id };

  const received = incoming.find((item) => item.requesterId === userId);
  if (received) return { friendship_status: "pending_incoming", friendship_id: received.id };

  return { friendship_status: "none", friendship_id: null };
}

export async function sendFriendRequest(userId) {
  return request(
    `${FRIENDS}/requests`,
    { method: "POST", ...jsonBody({ addresseeId: userId }) },
    "Failed to send friend request",
  );
}

export async function acceptFriendRequest(requestId) {
  return request(
    `${FRIENDS}/requests/${requestId}/accept`,
    { method: "POST" },
    "Failed to accept friend request",
  );
}

export async function declineFriendRequest(requestId) {
  return request(
    `${FRIENDS}/requests/${requestId}/decline`,
    { method: "POST" },
    "Failed to decline friend request",
  );
}

/**
 * Cancels a request *you* sent. identity's DELETE /friends/{userId} drops the
 * friendship row whatever its status, so it takes the other user's id.
 */
export async function cancelFriendRequest(userId) {
  return removeFriend(userId);
}

export async function removeFriend(userId) {
  return request(`${FRIENDS}/${userId}`, { method: "DELETE" }, "Failed to remove friend");
}
