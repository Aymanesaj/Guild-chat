import { buildQuery, request } from "./http";

/**
 * Friends module — owned by IDENTITY-SERVICE.
 *
 * Friendships are a relationship between two users, so they live with the
 * user data rather than in chat-service.
 *
 * Gateway route:  location /api/users/  ->  identity-service
 *                 rewrite ^/api/users/(.*)$ /$1
 *   frontend calls  /api/users/friends/list  ->  service handles  /friends/list
 *
 * Two id types are in play here, and mixing them up is the easiest bug to hit:
 *   - friendId   = a USER id           (used by /add and /delete)
 *   - requestId  = a FRIENDSHIP ROW id (used by /request/{id}/...)
 * A pending request object carries BOTH: { id, friendship_id, sender }.
 */
const FRIENDS = "/api/users/friends";

/**
 * GET /friends/list?limit&offset   (identity-service)
 * Used by: ProfileOverlay friends tab, and MembersSidebar (to offer friends
 * as candidates to invite into a room).
 *
 * Response: [ { id, username, display_name, avatar, status } ]
 *           — accepted friendships only, `id` being the friend's USER id.
 */
export async function getFriendsList({ limit = 50, offset = 0 } = {}) {
  return request(
    `${FRIENDS}/list${buildQuery({ limit, offset })}`,
    {},
    "Failed to fetch friends",
  );
}

/**
 * GET /friends/requests?limit&offset   (identity-service)
 * Used by: ProfileOverlay requests tab.
 *
 * Response: [ { id, friendship_id, sender: { id, username, avatar, status } } ]
 *           — INCOMING pending requests addressed to the current user.
 *           `friendship_id` is what /request/{id}/accept|decline takes.
 */
export async function getFriendRequests({ limit = 50, offset = 0 } = {}) {
  return request(
    `${FRIENDS}/requests${buildQuery({ limit, offset })}`,
    {},
    "Failed to fetch friend requests",
  );
}

/**
 * POST /friends/add/{friendId}   (identity-service)
 * Used by: ProfilePreviewPopover "Add friend".
 *
 * `friendId` is the target's USER id. No body. Creates a pending friendship
 * with the caller as sender.
 * Errors:   409 if a friendship or pending request already exists in either
 *           direction, 400 when adding yourself.
 */
export async function sendFriendRequest(friendId) {
  return request(
    `${FRIENDS}/add/${friendId}`,
    { method: "POST" },
    "Failed to send friend request",
  );
}

/**
 * POST /friends/request/{requestId}/accept   (identity-service)
 * Used by: ProfileOverlay requests tab, ProfilePreviewPopover.
 *
 * `requestId` is the FRIENDSHIP id. Only the recipient may accept.
 */
export async function acceptFriendRequest(requestId) {
  return request(
    `${FRIENDS}/request/${requestId}/accept`,
    { method: "POST" },
    "Failed to accept friend request",
  );
}

/**
 * POST /friends/request/{requestId}/decline   (identity-service)
 * Used by: ProfileOverlay requests tab.
 *
 * `requestId` is the FRIENDSHIP id. Only the recipient may decline.
 */
export async function declineFriendRequest(requestId) {
  return request(
    `${FRIENDS}/request/${requestId}/decline`,
    { method: "POST" },
    "Failed to decline friend request",
  );
}

/**
 * DELETE /friends/request/{requestId}   (identity-service)
 * Used by: ProfilePreviewPopover "Cancel request".
 *
 * Cancels a request the CALLER sent — the sender-side counterpart of decline.
 * `requestId` is the FRIENDSHIP id.
 */
export async function cancelFriendRequest(requestId) {
  return request(
    `${FRIENDS}/request/${requestId}`,
    { method: "DELETE" },
    "Failed to cancel friend request",
  );
}

/**
 * DELETE /friends/delete/{friendId}   (identity-service)
 * Used by: ProfileOverlay friends list, ProfilePreviewPopover "Remove friend".
 *
 * `friendId` is the friend's USER id (not the friendship id). Removes an
 * accepted friendship in both directions.
 */
export async function removeFriend(friendId) {
  return request(
    `${FRIENDS}/delete/${friendId}`,
    { method: "DELETE" },
    "Failed to remove friend",
  );
}
