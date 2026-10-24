import { buildQuery, jsonBody, request } from "./http";
import { getCurrentUserId } from "./tokens";
import { resolveUsers } from "./users";
import { validateRoomDetails } from "../utils/roomValidation";
import { messagePreviewText } from "../utils/attachments";

/**
 * Rooms, DMs, members and roles are owned by org-service (gateway prefix
 * /api/orgs). There are no invites: an owner/admin adds a member directly.
 */
const ROOMS = "/api/orgs/rooms";
const DM_ROOMS = `${ROOMS}/dm`;

/** org-service RoomResponse -> the shape the UI renders. */
function normalizeRoom(room) {
  return {
    id: room.id,
    name: room.name ?? null,
    description: room.description ?? "",
    type: String(room.type || "").toLowerCase(), // "dm" | "group"
    created_at: room.createdAt ?? null,
    updated_at: room.updatedAt ?? null,
    // org-service fills userIdIfDm with the other member on every DM response.
    peer_id: room.userIdIfDm ?? null,
    peer: null,
  };
}

/** org roles are OWNER | ADMIN | MEMBER; the UI compares lowercase. */
async function listMembers(roomId) {
  const members = await request(
    `${ROOMS}/${roomId}/members`,
    {},
    "Failed to fetch room members",
  );
  return (members || []).map((member) => ({
    userId: member.userId,
    role: String(member.role || "").toLowerCase(),
  }));
}

/**
 * DMs have no name, so the other member is what the UI shows. RoomResponse
 * names them in userIdIfDm; only fall back to /members if it's missing.
 */
async function withPeers(rooms) {
  const me = getCurrentUserId();

  const peerIds = await Promise.all(
    rooms.map(async (room) => {
      if (room.type !== "dm") return null;
      if (room.peer_id) return room.peer_id;
      try {
        const members = await listMembers(room.id);
        return members.find((member) => member.userId !== me)?.userId ?? null;
      } catch {
        return null;
      }
    }),
  );

  const users = await resolveUsers(peerIds);
  return rooms.map((room, index) =>
    room.type === "dm"
      ? { ...room, peer: users.get(peerIds[index]) ?? null }
      : room,
  );
}

/** GET /rooms — group rooms only; org-service serves DMs from /rooms/dm. */
export async function getRooms() {
  const rooms = await request(ROOMS, {}, "Failed to fetch rooms");
  return (rooms || []).map(normalizeRoom);
}

/** Resolve a notification's room, including the peer for a direct conversation. */
export async function getRoom(roomId) {
  const room = await request(`${ROOMS}/${encodeURIComponent(roomId)}`, {}, "This room is no longer available");
  const [resolved] = await withPeers([normalizeRoom(room)]);
  return resolved;
}

/** GET /rooms/dm — the caller's DM rooms, each with its peer resolved. */
async function getDmRooms() {
  const rooms = await request(DM_ROOMS, {}, "Failed to fetch conversations");
  return withPeers((rooms || []).map(normalizeRoom));
}

export async function createRoom(name, description = "") {
  const error = validateRoomDetails(name, description);
  if (error) throw new Error(error);
  const room = await request(
    ROOMS,
    { method: "POST", ...jsonBody({ name, description }) },
    "Failed to create room",
  );
  return normalizeRoom(room);
}

/** Owner/admin only. A missing description preserves its current value. */
export async function updateRoom(roomId, name, description) {
  const error = validateRoomDetails(name, description);
  if (error) throw new Error(error);
  const room = await request(
    `${ROOMS}/${roomId}`,
    { method: "PATCH", ...jsonBody({ name, description }) },
    "Failed to update room",
  );
  return normalizeRoom(room);
}

export async function leaveRoom(roomId) {
  return request(
    `${ROOMS}/${roomId}/members/me`,
    { method: "DELETE" },
    "Failed to leave room",
  );
}

/** Read-only: reuse an existing DM, or open a local conversation until Send. */
export async function openDm(peer) {
  const rooms = await getDmRooms();
  const existing = rooms.find((room) => (room.peer_id ?? room.peer?.id) === peer.id);
  if (existing) return existing;

  return {
    id: `draft-dm:${peer.id}`,
    name: null,
    type: "dm",
    isDraft: true,
    peer_id: peer.id,
    peer,
  };
}

/** Creates (or reuses) the DM when the user sends a message. */
export async function getOrCreateDm(userId) {
  const room = await request(
    DM_ROOMS,
    { method: "POST", ...jsonBody({ userId }) },
    "Failed to open conversation",
  );
  const [withPeer] = await withPeers([normalizeRoom(room)]);
  return withPeer;
}

/**
 * The current user's role in a room: "owner" | "admin" | "member", or null.
 * Only the raw member list: no identity lookups, unlike getRoomMembers.
 */
export async function getMyRoomRole(roomId) {
  const me = getCurrentUserId();
  const members = await listMembers(roomId);
  return members.find((member) => member.userId === me)?.role || null;
}

/** -> [{ id, username, display_name, avatar, status, role: "owner" | "admin" | "member" }] */
export async function getRoomMembers(roomId) {
  const members = await listMembers(roomId);
  const users = await resolveUsers(members.map((member) => member.userId));

  return members.map(({ userId, role }) => {
    const user = users.get(userId);
    return {
      id: userId,
      username: user?.username ?? "Unknown user",
      display_name: user?.display_name ?? null,
      avatar: user?.avatar ?? null,
      status: user?.status ?? "offline",
      role,
    };
  });
}

/** Owner/admin only. The user joins right away — org-service has no invites. */
export async function addMember(roomId, userId) {
  return request(
    `${ROOMS}/${roomId}/members`,
    { method: "POST", ...jsonBody({ userId }) },
    "Failed to add member",
  );
}

export async function removeMember(roomId, userId) {
  return request(
    `${ROOMS}/${roomId}/members/${userId}`,
    { method: "DELETE" },
    "Failed to remove member",
  );
}

/** role: "admin" | "member" — OWNER can't be assigned. */
export async function assignRole(roomId, userId, role) {
  return request(
    `${ROOMS}/${roomId}/members/${userId}/roles`,
    { method: "PATCH", ...jsonBody({ roleName: String(role).toUpperCase() }) },
    "Failed to assign role",
  );
}

// --- DM list ----------------------------------------------------------------

function formatTimestamp(value) {
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

/** The DM list shape the UI renders, from a room that went through withPeers. */
export function toConversation(room) {
  const peer = room.peer ?? null;
  const last = room.last_message ?? null;

  return {
    id: room.id,
    userId: peer?.id ?? null,
    username: peer?.username ?? room.name ?? "Direct message",
    avatar: peer?.avatar ?? null,
    status: peer?.status ?? "offline",
    lastMessage: last?.content ?? "",
    timestamp: formatTimestamp(last?.sent_at),
  };
}
/** chat-service answers at most 100 rooms per request. */
const MAX_PREVIEW_ROOMS = 100;

/** Newest message of each room, in one request per 100 rooms. -> Map<roomId, preview|null> */
async function fetchLastMessages(roomIds) {
  const previews = new Map();
  for (let start = 0; start < roomIds.length; start += MAX_PREVIEW_ROOMS) {
    const chunk = roomIds.slice(start, start + MAX_PREVIEW_ROOMS);
    try {
      const data = await request(
        `/api/chat/rooms/last-messages${buildQuery({ ids: chunk.join(",") })}`,
        {},
        "Failed to load messages",
      );
      Object.entries(data || {}).forEach(([id, last]) =>
        previews.set(
          Number(id),
          last
            ? {
                // id: lets a room.activity edit or delete find the preview it changes.
                id: last.id,
                content: messagePreviewText(last),
                sent_at: last.created_at,
              }
            : null,
        ),
      );
    } catch {
      chunk.forEach((id) => previews.set(Number(id), null)); // previews are optional
    }
  }
  return previews;
}

const dmSortKey = (room) =>
  new Date(
    room.last_message?.sent_at ?? room.updated_at ?? room.created_at ?? 0,
  ).getTime();

/** Newest conversation first. A copy: React state is never sorted in place. */
export function sortDmRooms(rooms) {
  return [...rooms].sort((a, b) => dmSortKey(b) - dmSortKey(a));
}

/**
 * The caller's DM rooms, reusing the previews already in `known`.
 *
 * Existing rooms keep their previews; only newly discovered rooms need the
 * batched last-messages request.
 *
 * Keeping previews fresh is the socket's job: DmView applies each
 * `room.activity` event (see onRoomEvent in messages.js) to `known`, so this
 * call only has to discover conversations. Rooms that have disappeared are
 * simply absent from the result.
 */
export async function syncDmRooms(known = []) {
  const previews = new Map(known.map((room) => [room.id, room.last_message]));
  const rooms = await getDmRooms();

  const missing = rooms
    .filter((room) => !previews.has(room.id))
    .map((room) => Number(room.id));
  const fetched = missing.length ? await fetchLastMessages(missing) : new Map();

  return rooms.map((room) => ({
    ...room,
    last_message: previews.has(room.id)
      ? previews.get(room.id)
      : (fetched.get(Number(room.id)) ?? null),
  }));
}
