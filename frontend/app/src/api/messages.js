import { buildQuery, ensureFreshToken, LOGOUT_EVENT, refreshSession, request } from "./http";
import { getAccessToken, getRefreshToken, isAccessTokenExpired } from "./tokens";
import { resolveUsers } from "./users";

/**
 * Messages. History over REST; sending and live delivery over chat-service's
 * single `/ws/chat` socket, shared by every open room. chat-service has no
 * REST send and echoes each message back to all of the sender's sessions, so a
 * sent message shows up through the subscription like anyone else's.
 */

function normalizeMessage(message, username) {
  return {
    id: message.id,
    room_id: message.roomId,
    sender_id: message.senderId,
    sender_username: message.senderUsername ?? username ?? null,
    content: message.content,
    sent_at: message.sentAt,
  };
}

/** Oldest -> newest. chat-service pages newest-first, so the page is reversed. */
export async function listMessages(roomId, { page = 0, size = 50 } = {}) {
  const history = await request(
    `/api/rooms/${roomId}/messages${buildQuery({ page, size })}`,
    {},
    "Failed to load messages",
  );

  // History only stores senderId — the name comes from identity.
  const items = [...(history || [])].reverse();
  const senders = await resolveUsers(items.map((item) => item.senderId));

  return items.map((item) => normalizeMessage(item, senders.get(item.senderId)?.username));
}

// --- shared socket ------------------------------------------------------------

const subscribers = new Map(); // roomId -> Set<handler>
const statusListeners = new Set();

let socket = null;
let status = "closed";
let timer = null;
let attempt = 0;

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

function connect() {
  clearTimeout(timer);
  timer = null;
  if (socket || !hasSubscribers() || !getAccessToken()) return;

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
    setStatus("open");
  };

  current.onmessage = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return; // ignore frames that aren't JSON
    }

    const message = normalizeMessage(frame);
    subscribers.get(message.room_id)?.forEach((handler) => handler(message));
  };

  current.onerror = () => setStatus("error");

  current.onclose = async (event) => {
    if (socket !== current) return;
    socket = null;
    setStatus("closed");
    if (!hasSubscribers()) return;

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
  attempt = 0;

  const current = socket;
  socket = null;
  current?.close(1000);
  setStatus("closed");
}

window.addEventListener(LOGOUT_EVENT, () => {
  subscribers.clear();
  disconnect();
});

/** Live messages for one room. Returns an unsubscribe function. */
export function subscribeToRoom(roomId, handler) {
  if (!subscribers.has(roomId)) subscribers.set(roomId, new Set());
  subscribers.get(roomId).add(handler);
  connect();

  return () => {
    const handlers = subscribers.get(roomId);
    handlers?.delete(handler);
    if (handlers && handlers.size === 0) subscribers.delete(roomId);
    if (!hasSubscribers()) disconnect();
  };
}

/** Socket status: "connecting" | "open" | "closed" | "error". */
export function onConnectionStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

function waitForOpen(timeoutMs = 5000) {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);

  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      stop();
      reject(new Error("Chat connection unavailable"));
    }, timeoutMs);

    const stop = onConnectionStatus((next) => {
      if (next !== "open") return;
      clearTimeout(deadline);
      queueMicrotask(stop);
      resolve(socket);
    });
  });
}

/**
 * Sends over the shared socket. Resolves once the frame is written — the
 * server doesn't ack, and silently drops messages to rooms you're not in.
 * Opens a short-lived subscription if nothing is connected yet (e.g. sending
 * a DM from a profile preview).
 */
export async function sendMessage(roomId, content) {
  const release = hasSubscribers() ? null : subscribeToRoom(roomId, () => {});

  try {
    const open = await waitForOpen();
    open.send(JSON.stringify({ roomId, content }));
  } finally {
    release?.();
  }
}
