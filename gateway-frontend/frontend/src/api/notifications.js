import { buildQuery, jsonBody, request } from "./http";
import { resolveUsers } from "./users";

/**
 * Unread counts, read marks and stored notifications (chat-service, see
 * API_CONTRACT.md "Notifications"). Live changes arrive on the chat socket:
 * room.read through onRoomEvent, notification.* through onNotificationEvent.
 */

const CHAT = "/api/chat";
/** chat-service answers at most 100 rooms per request. */
const MAX_ROOMS = 100;
/** Counts stop at 100 on the server: show "99+" from there. */
export const MAX_UNREAD = 100;

/** -> Map<roomId (number), count>. A chunk that fails is left out: badges are optional. */
export async function getUnreadCounts(roomIds) {
  const counts = new Map();
  for (let start = 0; start < roomIds.length; start += MAX_ROOMS) {
    const chunk = roomIds.slice(start, start + MAX_ROOMS);
    try {
      const data = await request(
        `${CHAT}/rooms/unread${buildQuery({ ids: chunk.join(",") })}`,
        {},
        "Failed to load unread counts",
      );
      Object.entries(data || {}).forEach(([id, count]) => counts.set(Number(id), count));
    } catch {
      // keep the counts we have
    }
  }
  return counts;
}

/** Marks the room read up to messageId. -> { room_id, last_read_id, unread } */
export function markRoomRead(roomId, messageId) {
  return request(
    `${CHAT}/rooms/${roomId}/read`,
    { method: "PUT", ...jsonBody({ message_id: messageId }) },
    "Failed to mark the conversation read",
  );
}

/** Adds actor_username: chat stores ids only, names come from identity. */
async function withActors(notifications) {
  const users = await resolveUsers(notifications.map((notification) => notification.actor_id));
  return notifications.map((notification) => ({
    ...notification,
    actor_username: users.get(notification.actor_id)?.username ?? "Someone",
  }));
}

/** Newest first. `before` = id of the oldest notification already loaded. */
export async function listNotifications({ before, limit = 20 } = {}) {
  const page = await request(
    `${CHAT}/notifications${buildQuery({ before, limit })}`,
    {},
    "Failed to load notifications",
  );
  return withActors(page || []);
}

/** One notification from the socket, with its actor's name. */
export async function withActor(notification) {
  const [named] = await withActors([notification]);
  return named;
}

export async function getNotificationUnreadCount() {
  const data = await request(`${CHAT}/notifications/unread-count`, {}, "Failed to load notifications");
  return data?.unread ?? 0;
}

/** -> { ids, all: false, unread } */
export function markNotificationsRead(ids) {
  return request(
    `${CHAT}/notifications/read`,
    { method: "PUT", ...jsonBody({ ids }) },
    "Failed to mark notifications read",
  );
}

/** -> { ids: null, all: true, unread } */
export function markAllNotificationsRead() {
  return request(`${CHAT}/notifications/read-all`, { method: "PUT" }, "Failed to mark notifications read");
}

/** Acknowledges incoming friend-request notifications, including those on older pages. */
export function markFriendRequestNotificationsRead() {
  return request(`${CHAT}/notifications/read-friend-requests`, { method: "PUT" }, "Failed to mark friend requests read");
}
