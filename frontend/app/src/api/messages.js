import { buildQuery, ensureFreshToken, jsonBody, LOGOUT_EVENT, refreshSession, request } from "./http";
import { getAccessToken, getRefreshToken, isAccessTokenExpired } from "./tokens";
import { resolveUsers } from "./users";

/**
 * Messages. History, sending, editing and deleting over REST; live updates
 * over chat-service's single `/ws/chat` socket, shared by every open room.
 *
 * REST goes through the gateway's `/api/chat/` prefix, which is stripped
 * before chat-service sees the path. JSON is snake_case.
 *
 * The socket opens at login (`connectChat`, called by AppShell) and stays open
 * until logout, even with no room open: chat-service counts an open socket as
 * "online" (GET /presence).
 *
 * The socket carries `{ event, data }` frames. The client subscribes per room;
 * the server forgets subscriptions when a socket closes, so every (re)connect
 * subscribes again. A POST's own message also arrives as `message.new`, and
 * the hook dedupes it by id.
 */

const CHAT = "/api/chat";

function normalizeMessage(message, sender) {
  return {
    id: message.id,
    room_id: message.room_id,
    sender_id: message.sender_id,
    sender_username: sender?.username ?? null,
    sender_avatar: sender?.avatar ?? null,
    reply_to_id: message.reply_to_id ?? null,
    content: message.content,
    sent_at: message.created_at,
    edited_at: message.edited_at ?? null,
    deleted: Boolean(message.deleted),
  };
}

/** Attaches senders: chat stores ids only, names and avatars come from identity. */
async function withUsernames(messages) {
  const senders = await resolveUsers(messages.map((message) => message.sender_id));
  return messages.map((message) => normalizeMessage(message, senders.get(message.sender_id)));
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

/** The stored message, as the server returned it (201). */
export async function sendMessage(roomId, content, replyToId) {
  const saved = await request(
    `${CHAT}/rooms/${roomId}/messages`,
    { method: "POST", ...jsonBody({ content, reply_to_id: replyToId }) },
    "Failed to send message",
  );
  const [message] = await withUsernames([saved]);
  return message;
}

export async function getMessage(messageId) {
  const message = await request(`${CHAT}/messages/${messageId}`, {}, "Failed to load message");
  const [normalized] = await withUsernames([message]);
  return normalized;
}

/** Sender only, within 15 minutes of sending. */
export async function editMessage(messageId, content) {
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
  await request(`${CHAT}/messages/${messageId}`, { method: "DELETE" }, "Failed to delete message");
}

// --- shared socket ------------------------------------------------------------

/** roomId (as a string: route params are strings, the server sends numbers) -> Set<handler> */
const subscribers = new Map();
const statusListeners = new Set();

let socket = null;
let status = "closed";
let timer = null;
let attempt = 0;
/** Pending close after the last room left; a room switch cancels it. */
let idleTimer = null;
/** True from connectChat() until logout: the socket is the user's presence, so rooms don't decide. */
let keepOpen = false;
const IDLE_CLOSE_MS = 2000;

const roomKey = (roomId) => String(roomId);

function setStatus(next) {
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = encodeURIComponent(getAccessToken() ?? "");
  return `${protocol}//${window.location.host}/ws/chat?token=${token}`;
}

function hasSubscribers() {
  return subscribers.size > 0;
}

function wantsSocket() {
  return keepOpen || hasSubscribers();
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

function dispatch(roomId, update) {
  subscribers.get(roomKey(roomId))?.forEach((handler) => handler(update));
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
    case "message.new": {
      const [message] = await withUsernames([data]);
      dispatch(data.room_id, { type: "new", message });
      break;
    }
    case "message.edited":
      dispatch(data.room_id, { type: "edited", id: data.id, content: data.content, edited_at: data.edited_at });
      break;
    case "message.deleted":
      dispatch(data.room_id, { type: "deleted", id: data.id });
      break;
    case "error":
      // e.g. NOT_A_MEMBER after being removed from a room; the socket stays
      // open and the room view reflects the state, so this is a debug-level
      // note rather than a console warning.
      console.debug(`chat socket: ${data.code}: ${data.message}`);
      break;
    default:
      break; // unknown events are ignored so the server can add new ones
  }
}

function connect() {
  clearTimeout(timer);
  timer = null;
  if (socket || !wantsSocket() || !getAccessToken()) return;

  setStatus("connecting");

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
    attempt = 0;
    // A new socket starts with no subscriptions on the server.
    subscribers.forEach((_, key) => sendRoomFrame("subscribe", key));
    setStatus("open");
  };

  current.onmessage = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return; // ignore frames that aren't JSON
    }
    handleFrame(frame);
  };

  current.onerror = () => setStatus("error");

  current.onclose = async (event) => {
    if (socket !== current) return;
    socket = null;
    setStatus("closed");
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
  current?.close(1000);
  setStatus("closed");
}

window.addEventListener(LOGOUT_EVENT, () => {
  keepOpen = false;
  subscribers.clear();
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
    if (!wantsSocket()) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(disconnect, IDLE_CLOSE_MS);
    }
  };
}

/** Socket status: "connecting" | "open" | "closed" | "error". */
export function onConnectionStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}
