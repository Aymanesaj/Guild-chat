/**
 * Unread badges and the notification list (see chat-service API_CONTRACT.md,
 * "Notifications"). Pure functions: the React state lives in UnreadContext
 * and useNotificationFeed.
 */
import { MAX_UNREAD } from "../api/notifications";

const ROLE_LABELS = { OWNER: "owner", ADMIN: "admin", MEMBER: "member" };

/** Badge text: "" for none, "99+" past what the server counts. */
export function formatUnread(count) {
  if (!count || count < 1) return "";
  return count >= MAX_UNREAD ? "99+" : String(count);
}

/**
 * Unread counts (Map<roomId string, count>) after one onRoomEvent event.
 * Returns the same Map when nothing changes, so React can skip a render.
 *
 * A new message counts when someone else sent it and the room is not being
 * read right now (`isReading(roomId)`); edits and deletes change nothing,
 * since we cannot tell whether that message was unread (a resync corrects it).
 */
export function applyUnreadEvent(counts, event, { userId, isReading = () => false }) {
  const key = String(event.roomId);
  if (event.type === "read") {
    if (counts.get(key) === event.unread) return counts;
    return new Map(counts).set(key, event.unread);
  }
  if (event.type === "removed") {
    if (!counts.has(key)) return counts;
    const next = new Map(counts);
    next.delete(key);
    return next;
  }
  if (event.type !== "activity" || event.change !== "new") return counts;
  if (event.isSystem || !event.senderId || event.senderId === userId || isReading(key)) return counts;
  return new Map(counts).set(key, Math.min((counts.get(key) ?? 0) + 1, MAX_UNREAD));
}

/** The line shown for a stored notification. `roomName` may be unknown (removed from it). */
export function describeNotification(notification, roomName) {
  const actor = notification.actor_username ?? "Someone";
  const room = roomName ? `#${roomName}` : "a room";
  switch (notification.type) {
    case "FRIEND_REQUEST":
      return `${actor} sent you a friend request`;
    case "FRIEND_ACCEPTED":
      return `${actor} accepted your friend request`;
    case "ROOM_ADDED":
      return `${actor} added you to ${room}`;
    case "ROOM_REMOVED":
      return `${actor} removed you from ${room}`;
    case "ROLE_CHANGED":
      return `${actor} made you ${ROLE_LABELS[notification.role] ?? "a member"} in ${room}`;
    default:
      return "You have a new notification"; // a type added after this client
  }
}

/** Where clicking it goes, in AppShell's navigateNotification shape; null when nowhere. */
export function notificationDestination(notification) {
  switch (notification.type) {
    case "FRIEND_REQUEST":
      return { type: "profile", tab: "requests" };
    case "FRIEND_ACCEPTED":
      return { type: "profile", tab: "friends" };
    case "ROOM_ADDED":
    case "ROLE_CHANGED":
      return notification.room_id == null ? null : { type: "room", roomId: notification.room_id };
    default:
      return null; // removed from the room: nothing to open
  }
}

/** The list after a notification.read frame (or our own read): { ids, all }. */
export function applyNotificationsRead(notifications, { ids, all }) {
  const read = all ? null : new Set(ids ?? []);
  let changed = false;
  const next = notifications.map((notification) => {
    if (notification.read || (read && !read.has(notification.id))) return notification;
    changed = true;
    return { ...notification, read: true };
  });
  return changed ? next : notifications;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "now", "5 minutes ago", "yesterday"... */
export function timeAgo(timestamp, now = Date.now()) {
  const seconds = Math.round((Date.parse(timestamp) - now) / 1000);
  if (Number.isNaN(seconds)) return "";
  const elapsed = Math.abs(seconds);
  if (elapsed < 60) return relative.format(0, "second");
  if (elapsed < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (elapsed < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}
