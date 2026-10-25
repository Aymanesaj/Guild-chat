import {
  ApiError,
  buildQuery,
  ensureFreshToken,
  jsonBody,
  LOGOUT_EVENT,
  refreshSession,
  request,
} from "./http";
import {
  getAccessToken,
  getRefreshToken,
  isAccessTokenExpired,
} from "./tokens";
import { resolveUsers } from "./users";
import { assertMessageSize } from "../utils/messageContent";
import { messagePreviewText } from "../utils/attachments";

/**
 * Messages. History, sending, editing and deleting over REST; live updates
 * over chat-service's single `/ws/chat` socket, shared by every open room.
 *
 * REST goes through the gateway's `/api/chat/` prefix, which is stripped
 * before chat-service sees the path. JSON is snake_case.
 *
 * The socket opens at login (`connectChat`, called by AppShell) and stays open
 * until logout, even with no room open: chat-service counts an open socket as
 * "online". Presence subscriptions receive snapshots and live changes.
 *
 * The socket carries `{ event, data }` frames. The client subscribes per room;
 * the server forgets subscriptions when a socket closes, so every (re)connect
 * subscribes again. A POST's own message also arrives as `message.new`, and
 * the hook dedupes it by id.
 *
 * Some frames are about the user rather than a room, and arrive without any
 * subscription: room list changes pushed by org-service through chat
 * (`room.added` / `room.removed` / `room.updated`) and `room.activity` for
 * list previews. `onRoomEvent` delivers those.
 */

const CHAT = "/api/chat";

function normalizeMessage(message, users) {
  const sender = users.get(message.sender_id);
  return {
    id: message.id,
    room_id: message.room_id,
    sender_id: message.sender_id,
    sender_username: sender?.username ?? null,
    sender_avatar: sender?.avatar ?? null,
    reply_to_id: message.reply_to_id ?? null,
    content: message.content,
    content_type: message.content_type ?? "text",
    system: normalizeSystem(message.system, users),
    sent_at: message.created_at,
    edited_at: message.edited_at ?? null,
    deleted: Boolean(message.deleted),
    // [{ media_id, content_type, width, height, url, url_expires_at }]; url can be null.
    attachments: message.attachments ?? [],
  };
}

/** Room events (member joined, kicked, ...): chat sends ids, names are resolved here. */
function normalizeSystem(system, users) {
  if (!system) return null;
  return {
    type: system.type,
    actor_id: system.actor_id,
    actor_username: users.get(system.actor_id)?.username ?? "Someone",
    target_id: system.target_id,
    target_username: users.get(system.target_id)?.username ?? "someone",
    role: system.role,
    previous_role: system.previous_role,
    name: system.name,
    previous_name: system.previous_name,
  };
}

/** Attaches users: chat stores ids only, names and avatars come from identity. */
async function withUsernames(messages) {
  // Senders, plus the people named in system messages. resolveUsers skips nulls.
  const users = await resolveUsers(
    messages.flatMap((message) => [
      message.sender_id,
      message.system?.actor_id,
      message.system?.target_id,
    ]),
  );
  return messages.map((message) => normalizeMessage(message, users));
}

/**
 * Oldest -> newest. chat-service pages newest-first, so the page is reversed.
 * `before` = id of the oldest message already loaded, for the page above it.
 */
export async function listMessages(roomId, { before, limit = 50 } = {}) {
  const page = await request(
    `${CHAT}/rooms/${roomId}/messages${buildQuery({ before, limit })}`,
    {},
    "Failed to load messages",
  );
  return withUsernames([...(page || [])].reverse());
}

/**
 * One chat image: upload-url -> PUT straight to R2. Returns the upload_id to
 * send with the message; media checks, resizes and converts the file when the
 * message is sent, not here.
 */
export async function uploadImage(roomId, file) {
  const ticket = await request(
    `${CHAT}/rooms/${roomId}/attachments/upload-url`,
    { method: "POST", ...jsonBody({ content_type: file.type }) },
    "Failed to start image upload",
  );

  // Exactly the Content-Type the URL was signed for, or R2 refuses the PUT.
  // No Authorization header: the signed URL is the permission.
  const put = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: { "Content-Type": ticket.content_type },
    body: file,
  });
  if (!put.ok) {
    throw new ApiError("Failed to upload image", put.status, null);
  }
  return ticket.upload_id;
}

/** The stored message, as the server returned it (201). Text, images (upload ids) or both. */
export async function sendMessage(roomId, content, replyToId, uploadIds = []) {
  assertMessageSize(content);
  const saved = await request(
    `${CHAT}/rooms/${roomId}/messages`,
    {
      method: "POST",
      ...jsonBody({
        content,
        reply_to_id: replyToId,
        attachment_upload_ids: uploadIds.length ? uploadIds : undefined,
      }),
    },
    "Failed to send message",
  );
  const [message] = await withUsernames([saved]);
  return message;
}

/** One message, with freshly signed image URLs: how an expired image link is renewed. */
export async function getMessage(messageId) {
  const message = await request(`${CHAT}/messages/${messageId}`, {}, "Failed to load message");
  const [normalized] = await withUsernames([message]);
  return normalized;
}

/** Sender only, within 15 minutes of sending. */
export async function editMessage(messageId, content) {
  assertMessageSize(content);
  const message = await request(
    `${CHAT}/messages/${messageId}`,
    { method: "PATCH", ...jsonBody({ content }) },
    "Failed to edit message",
  );
  const [normalized] = await withUsernames([message]);
  return normalized;
}

/** The sender, or a room owner/admin. */
export async function deleteMessage(messageId) {
  await request(
    `${CHAT}/messages/${messageId}`,
    { method: "DELETE" },
    "Failed to delete message",
  );
}

// --- shared socket ------------------------------------------------------------

/** roomId (as a string: route params are strings, the server sends numbers) -> Set<handler> */
const subscribers = new Map();
/** userId -> Set<handler>; shared across member lists, friends and DM peers. */
const presenceSubscribers = new Map();
const PRESENCE_BATCH_SIZE = 100;
/** Listeners for user-level room events, see onRoomEvent. */
const roomListeners = new Set();
/** Raw user-level events for notification displays; no additional socket. */
const notificationListeners = new Set();
/** False until the first successful open of this session: later opens are reconnects. */
let hasOpened = false;

let socket = null;
let timer = null;
let attempt = 0;
/** Pending close after the last room left; a room switch cancels it. */
let idleTimer = null;
/** True from connectChat() until logout: the socket is the user's presence, so rooms don't decide. */
let keepOpen = false;
const IDLE_CLOSE_MS = 2000;

const roomKey = (roomId) => String(roomId);

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = encodeURIComponent(getAccessToken() ?? "");
  return `${protocol}//${window.location.host}/ws/chat?token=${token}`;
}

function hasSubscribers() {
  return subscribers.size > 0;
}

function wantsSocket() {
  return keepOpen || hasSubscribers() || presenceSubscribers.size > 0;
}

/** Writes a frame if the socket is open. Closed? onopen will resubscribe. */
function sendFrame(event, data) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ event, data }));
}

/** room_id must be a JSON integer: the server rejects "42" with INVALID_ROOM_ID. */
function sendRoomFrame(event, key) {
  sendFrame(event, { room_id: Number(key) });
}

/** Match the backend's 100 distinct ids per presence frame limit. */
function sendPresenceFrames(event, userIds) {
  for (let start = 0; start < userIds.length; start += PRESENCE_BATCH_SIZE) {
    sendFrame(event, {
      user_ids: userIds.slice(start, start + PRESENCE_BATCH_SIZE),
    });
  }
}

function dispatchPresence(userId, status) {
  if (status !== "online" && status !== "offline") return;
  presenceSubscribers
    .get(userId)
    ?.forEach((handler) => handler({ userId, status }));
}

function dispatch(roomId, update) {
  subscribers.get(roomKey(roomId))?.forEach((handler) => handler(update));
}

function emitRoomEvent(event) {
  roomListeners.forEach((listener) => listener(event));
}

/**
 * room.activity's message, in the `last_message` shape the DM list stores
 * (see fetchLastMessages in rooms.js), so it can replace a preview as is.
 */
function toPreview(message) {
  return {
    id: message.id,
    content: messagePreviewText(message),
    sent_at: message.created_at,
  };
}

/**
 * Every handler receives one of:
 *   { type: "new",     message }
 *   { type: "edited",  id, content, edited_at }
 *   { type: "deleted", id }
 */
async function handleFrame(frame) {
  const { event, data } = frame ?? {};
  if (!data) return;

  switch (event) {
    case "presence.snapshot":
      Object.entries(data.statuses || {}).forEach(([userId, status]) =>
        dispatchPresence(userId, status),
      );
      break;
    case "presence.changed":
      dispatchPresence(data.user_id, data.status);
      break;
    case "message.new": {
      const [message] = await withUsernames([data]);
      dispatch(data.room_id, { type: "new", message });
      break;
    }
    case "message.edited":
      dispatch(data.room_id, {
        type: "edited",
        id: data.id,
        content: data.content,
        edited_at: data.edited_at,
      });
      break;
    case "message.deleted":
      dispatch(data.room_id, { type: "deleted", id: data.id });
      break;
    case "room.added":
    case "room.removed":
    case "room.updated":
      // "room.added" -> "added": the list only needs to know what to refetch.
      emitRoomEvent({
        type: event.slice("room.".length),
        roomId: data.room_id,
      });
      if (event !== "room.updated") {
        notificationListeners.forEach((listener) => listener({ event, data }));
      }
      break;
    case "room.activity":
      if (!data.message) break;
      notificationListeners.forEach((listener) => listener({ event, data }));
      emitRoomEvent({
        type: "activity",
        roomId: data.room_id,
        change: data.change,
        preview: toPreview(data.message),
        // Unread counts: only other people's messages count, never room events.
        senderId: data.message.sender_id ?? null,
        isSystem: data.message.content_type === "system",
      });
      break;
    case "room.read":
      emitRoomEvent({ type: "read", roomId: data.room_id, lastReadId: data.last_read_id, unread: data.unread ?? 0 });
      break;
    case "notification.new":
    case "notification.read":
      notificationListeners.forEach((listener) => listener({ event, data }));
      break;
    case "friend.request.received":
    case "friend.request.sent":
    case "friend.added":
      notificationListeners.forEach((listener) => listener({ event, data }));
      break;
    case "error":
      break;
    default:
      break; // unknown events are ignored so the server can add new ones
  }
}

function connect() {
  clearTimeout(timer);
  timer = null;
  if (socket || !wantsSocket() || !getAccessToken()) return;

  // The handshake only carries the token in the URL; don't send a stale one.
  if (isAccessTokenExpired()) {
    ensureFreshToken().then(() => {
      if (!isAccessTokenExpired()) connect();
    });
    return;
  }

  const current = new WebSocket(socketUrl());
  const refreshTokenAtConnect = getRefreshToken();
  socket = current;

  current.onopen = () => {
    if (socket !== current) return;
    attempt = 0;
    // A new socket starts with no subscriptions on the server.
    subscribers.forEach((_, key) => sendRoomFrame("subscribe", key));
    // Presence subscriptions return a fresh snapshot, including on reconnect.
    sendPresenceFrames("presence.subscribe", [...presenceSubscribers.keys()]);
    // Room events sent while the socket was down are lost for good, so lists
    // refetch once. Not on the first open: they are loading already.
    if (hasOpened) emitRoomEvent({ type: "resync" });
    hasOpened = true;
  };

  current.onmessage = (event) => {
    if (socket !== current) return;
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return; // ignore frames that aren't JSON
    }
    handleFrame(frame);
  };

  current.onclose = async (event) => {
    if (socket !== current) return;
    socket = null;
    if (!wantsSocket()) return;

    // A rejected handshake (expired token) surfaces as an abnormal 1006 close
    // with no detail, so refresh on any unexpected close before retrying.
    if (event.code !== 1000) {
      try {
        await refreshSession(refreshTokenAtConnect);
      } catch {
        return; // session is gone for good; App will bounce to /auth
      }
    }

    // Logout may have cleared the session while the refresh was in flight.
    if (!wantsSocket() || socket) return;

    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
    timer = setTimeout(connect, delay);
  };
}

function disconnect() {
  clearTimeout(timer);
  timer = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  attempt = 0;

  const current = socket;
  socket = null;
  if (current?.readyState === WebSocket.CONNECTING) {
    // Finish the handshake before closing to avoid a browser console error.
    // The socket is already detached, so it cannot deliver frames or reconnect.
    current.onopen = () => current.close(1000);
  } else {
    current?.close(1000);
  }
}

window.addEventListener(LOGOUT_EVENT, () => {
  keepOpen = false;
  hasOpened = false;
  subscribers.clear();
  presenceSubscribers.clear();
  roomListeners.clear();
  notificationListeners.clear();
  disconnect();
});

/** Opens the shared socket for the whole session (online presence). Safe to call twice. */
export function connectChat() {
  keepOpen = true;
  clearTimeout(idleTimer);
  idleTimer = null;
  connect();
}

/** Live updates for one room. Returns an unsubscribe function. */
export function subscribeToRoom(roomId, handler) {
  const key = roomKey(roomId);
  clearTimeout(idleTimer); // switching rooms: keep the socket we have
  idleTimer = null;
  const isNewRoom = !subscribers.has(key);
  if (isNewRoom) subscribers.set(key, new Set());
  subscribers.get(key).add(handler);

  if (isNewRoom) sendRoomFrame("subscribe", key); // no-op until open; onopen covers it
  connect();

  return () => {
    const handlers = subscribers.get(key);
    handlers?.delete(handler);
    if (handlers && handlers.size === 0) {
      subscribers.delete(key);
      sendRoomFrame("unsubscribe", key);
    }
    // Not at once: on a room switch React unsubscribes the old room before
    // subscribing the new one, and closing here would open a new socket per room.
    closeWhenUnused();
  };
}

function closeWhenUnused() {
  if (!wantsSocket()) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(disconnect, IDLE_CLOSE_MS);
  }
}

/**
 * Watch users through the shared socket. Receives { userId, status } for the
 * initial snapshot and later changes. Reconnect restores all watched users.
 * Overlapping hooks share subscriptions; only the final listener unsubscribes.
 */
export function subscribeToPresence(userIds, handler) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  clearTimeout(idleTimer);
  idleTimer = null;
  ids.forEach((id) => {
    if (!presenceSubscribers.has(id)) presenceSubscribers.set(id, new Set());
    presenceSubscribers.get(id).add(handler);
  });
  // Include already-watched users: a new listener also needs their snapshot.
  sendPresenceFrames("presence.subscribe", ids);
  connect();

  return () => {
    const removed = [];
    ids.forEach((id) => {
      const handlers = presenceSubscribers.get(id);
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        presenceSubscribers.delete(id);
        removed.push(id);
      }
    });
    sendPresenceFrames("presence.unsubscribe", removed);
    closeWhenUnused();
  };
}

/**
 * User-level room events, wherever the user is in the app and whether or not a
 * room is open. Returns an unsubscribe function.
 *
 * The listener receives one of:
 *   { type: "added",    roomId }  you can now see this room: refetch the list
 *   { type: "removed",  roomId }  you can no longer see it: refetch the list
 *   { type: "updated",  roomId }  name, members or roles changed
 *   { type: "activity", roomId, change: "new" | "edited" | "deleted",
 *     preview: { id, content, sent_at }, senderId, isSystem }
 *                                 a message in one of your rooms; for every
 *                                 room you are in, DMs and groups alike
 *   { type: "read", roomId, unread }
 *                                 you read this room (maybe in another tab):
 *                                 its unread count is now `unread`
 *   { type: "resync" }            the socket reconnected and events may have
 *                                 been missed: refetch whatever you show
 *
 * Does not open the socket: AppShell's connectChat keeps it open for the session.
 */
export function onRoomEvent(listener) {
  roomListeners.add(listener);
  return () => roomListeners.delete(listener);
}

/** Notification candidates on the session socket. Returns an unsubscribe function. */
export function onNotificationEvent(listener) {
  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
}
