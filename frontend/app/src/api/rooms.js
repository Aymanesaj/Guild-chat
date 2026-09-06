import { buildQuery, jsonBody, request } from "./http";

/**
 * Rooms module — owned by CHAT-SERVICE.
 *
 * Gateway route:  location /api/chat/  ->  chat-service
 *                 rewrite ^/api/chat/(.*)$ /$1
 *   frontend calls  /api/chat/rooms/5  ->  service handles  /rooms/5
 *
 * A "room" is both a group channel and a 1:1 DM — `type` tells them apart.
 * The DM list and the channel list in the sidebar are two filtered views of
 * the same GET /rooms response.
 *
 * The room object this app renders:
 *   {
 *     id, name,
 *     type,           // "dm" | "group"
 *     created_at, modified_at,
 *     peer,           // DM ONLY: the OTHER member, { id, username, status }
 *     last_message,   // { content, sent_at } or null — for the list preview
 *   }
 *
 * `peer` and `last_message` are what let the sidebar render without an extra
 * request per room; without them a DM has no name to show. See toConversation
 * at the bottom of this file.
 *
 * A member object is: { id, username, status, role }  (`id` = USER id,
 * `role` = "owner" | "admin" | "member").
 *
 * Authorisation is entirely the service's job: membership for reads, and
 * owner/admin for renaming, deleting, kicking, inviting and role changes.
 */
const ROOMS = "/api/chat/rooms";

/**
 * GET /rooms?limit&offset   (chat-service)
 * Used by: Sidebar channel list, DmView conversation list.
 *
 * Response: [ room ] — every room the CALLER is a member of, DMs included,
 *           each carrying `peer` (DMs) and `last_message`. Sort newest-active
 *           first; the UI does not re-sort.
 */
export async function getRooms({ limit, offset } = {}) {
  return request(`${ROOMS}${buildQuery({ limit, offset })}`, {}, "Failed to fetch rooms");
}

/**
 * GET /rooms/invites?limit&offset   (chat-service)
 * Used by: ProfileOverlay invites tab.
 *
 * Response: [ { id, room: { id, name }, inviter: { id, username } } ]
 *           — room invites addressed to the CURRENT user.
 *
 * Routing note: this must be matched BEFORE GET /rooms/{roomId}, otherwise
 * most routers read "invites" as a room id and 400/422 on the type cast.
 * Declare the literal path first (or constrain {roomId} to digits).
 */
export async function getRoomInvites({ limit = 50, offset = 0 } = {}) {
  return request(
    `${ROOMS}/invites${buildQuery({ limit, offset })}`,
    {},
    "Failed to fetch room invites",
  );
}

/**
 * GET /rooms/{roomId}   (chat-service)
 * Used by: RoomView / RoomHeader when opening a room by URL.
 *
 * Response: a single room object. 403 for non-members, 404 when unknown.
 */
export async function getRoom(roomId) {
  return request(`${ROOMS}/${roomId}`, {}, "Failed to fetch room");
}

/**
 * POST /rooms   (chat-service)
 * Used by: CreateRoomInput in the sidebar.
 *
 * Body:     { name }
 * Response: 201 + the created room, with the caller already added as a member
 *           with role "owner".
 */
export async function createRoom(name) {
  return request(
    ROOMS,
    { method: "POST", ...jsonBody({ name }) },
    "Failed to create room",
  );
}

/**
 * POST /rooms/dm   (chat-service)
 * Used by: ProfilePreviewPopover "Send message".
 *
 * Body:     { user_id }  — the other participant.
 * Response: the DM room (type "dm"). MUST be idempotent: return the existing
 *           room if one already exists between the two users rather than
 *           creating a duplicate.
 */
export async function getOrCreateDm(userId) {
  return request(
    `${ROOMS}/dm`,
    { method: "POST", ...jsonBody({ user_id: userId }) },
    "Failed to open conversation",
  );
}

/**
 * PATCH /rooms/{roomId}   (chat-service)
 * Used by: RoomHeader rename.
 *
 * Body:     a partial room, currently only { name }.
 * Response: the updated room. Owner/admin only.
 */
export async function updateRoom(roomId, payload) {
  return request(
    `${ROOMS}/${roomId}`,
    { method: "PATCH", ...jsonBody(payload) },
    "Failed to update room",
  );
}

/**
 * DELETE /rooms/{roomId}   (chat-service)
 * Used by: RoomHeader delete.
 *
 * Owner only. Should cascade to members, invites and messages.
 */
export async function deleteRoom(roomId) {
  return request(`${ROOMS}/${roomId}`, { method: "DELETE" }, "Failed to delete room");
}

/**
 * GET /rooms/{roomId}/members   (chat-service)
 * Used by: MembersSidebar / MemberList.
 *
 * Response: [ { id, username, status, role } ] — `id` is the USER id.
 */
export async function getRoomMembers(roomId) {
  return request(`${ROOMS}/${roomId}/members`, {}, "Failed to fetch room members");
}

/**
 * POST /rooms/{roomId}/members   (chat-service)
 * Used by: MembersSidebar, adding a friend directly.
 *
 * Body:     { user_id }
 * Response: the created member. Admin/owner only; 409 if already a member.
 */
export async function addMember(roomId, userId) {
  return request(
    `${ROOMS}/${roomId}/members`,
    { method: "POST", ...jsonBody({ user_id: userId }) },
    "Failed to add member",
  );
}

/**
 * DELETE /rooms/{roomId}/members/{userId}   (chat-service)
 * Used by: MemberItem kick, and leaveRoom below.
 *
 * Removing SOMEONE ELSE requires admin/owner; removing YOURSELF is always
 * allowed (that is "leave"). The owner leaving should either transfer
 * ownership or delete the room — the frontend does not handle that case.
 */
export async function removeMember(roomId, userId) {
  return request(
    `${ROOMS}/${roomId}/members/${userId}`,
    { method: "DELETE" },
    "Failed to remove member",
  );
}

/**
 * Leaving is removing yourself — the caller passes its own user id.
 *
 * If the team prefers a dedicated POST /rooms/{roomId}/leave (no client-
 * supplied id, simpler to authorise), only this function needs to change.
 */
export async function leaveRoom(roomId, userId) {
  return removeMember(roomId, userId);
}

/**
 * POST /rooms/{roomId}/members/{userId}/roles   (chat-service)
 * Used by: MemberItem role menu.
 *
 * Body:     { role }  — "admin" | "member" ("owner" is not assignable here).
 * Owner only. Response: the updated member.
 */
export async function assignRole(roomId, userId, role) {
  return request(
    `${ROOMS}/${roomId}/members/${userId}/roles`,
    { method: "POST", ...jsonBody({ role }) },
    "Failed to assign role",
  );
}

/**
 * GET /rooms/{roomId}/invites   (chat-service)
 * Used by: MembersSidebar, to grey out people already invited.
 *
 * Response: [ { id, user_id } ] — PENDING invites for THIS room.
 * Do not confuse with GET /rooms/invites, which is "invites addressed to me".
 */
export async function getRoomPendingInvites(roomId) {
  return request(`${ROOMS}/${roomId}/invites`, {}, "Failed to fetch pending invites");
}

/**
 * POST /rooms/{roomId}/invites   (chat-service)
 * Used by: MembersSidebar invite action.
 *
 * Body:     { user_id }
 * Response: 201 + { id, user_id }. Admin/owner only; 409 when the user is
 *           already a member or already invited.
 */
export async function inviteToRoom(roomId, userId) {
  return request(
    `${ROOMS}/${roomId}/invites`,
    { method: "POST", ...jsonBody({ user_id: userId }) },
    "Failed to send invite",
  );
}

/**
 * POST /rooms/invites/{inviteId}/accept   (chat-service)
 * Used by: ProfileOverlay invites tab.
 *
 * Adds the caller to the room and consumes the invite. Only the invitee may
 * accept. Response: the joined room.
 */
export async function acceptRoomInvite(inviteId) {
  return request(
    `${ROOMS}/invites/${inviteId}/accept`,
    { method: "POST" },
    "Failed to accept invite",
  );
}

/**
 * DELETE /rooms/invites/{inviteId}   (chat-service)
 * Used by: ProfileOverlay invites tab (decline).
 *
 * Also the natural route for an admin revoking an invite they sent.
 */
export async function declineRoomInvite(inviteId) {
  return request(
    `${ROOMS}/invites/${inviteId}`,
    { method: "DELETE" },
    "Failed to decline invite",
  );
}

// --- view helpers (no network) ----------------------------------------------

/**
 * Renders an ISO-8601 timestamp the way the conversation list wants it:
 * time today, "Yesterday", otherwise "05 Sep".
 *
 * Backend note: send timestamps as ISO-8601 WITH a timezone offset (or a
 * trailing Z). A naive "2026-09-06 14:03:00" is parsed inconsistently across
 * browsers and will render as an empty string here.
 */
export function formatTimestamp(value) {
  if (!value) return "";

  const sent = new Date(value);
  if (Number.isNaN(sent.getTime())) return "";

  const now = new Date();
  const sameDay = sent.toDateString() === now.toDateString();
  if (sameDay) {
    return sent.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sent.toDateString() === yesterday.toDateString()) return "Yesterday";

  return sent.toLocaleDateString([], { day: "2-digit", month: "short" });
}

/**
 * Flattens a room into the DM list shape the UI renders. This is the exact
 * reason GET /rooms must widen DMs with `peer` and `last_message`: a DM has no
 * `name`, so without `peer` there is nothing to display but a fallback.
 */
export function toConversation(room) {
  const peer = room.peer ?? null;
  const last = room.last_message ?? null;

  return {
    id: room.id,
    userId: peer?.id ?? null,
    username: peer?.username ?? room.name ?? "Direct message",
    status: peer?.status ?? "offline",
    lastMessage: last?.content ?? "",
    timestamp: formatTimestamp(last?.sent_at),
  };
}

/** Convenience: GET /rooms, keep the DMs, map them for the list. */
export async function listDmConversations() {
  const rooms = await getRooms();
  return (rooms || []).filter((room) => room.type === "dm").map(toConversation);
}
