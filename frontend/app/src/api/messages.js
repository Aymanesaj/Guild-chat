import { buildQuery, jsonBody, refreshSession, request } from "./http";

/**
 * Messages module — owned by CHAT-SERVICE.
 *
 * Two transports:
 *   REST       /api/chat/rooms/{roomId}/messages   history + sending
 *   WebSocket  /ws/chat/rooms/{roomId}             live delivery
 *
 * Gateway routes (both rewrite the prefix away):
 *   location /api/chat/  ->  chat-service   ^/api/chat/(.*)$  -> /$1
 *   location /ws/chat/   ->  chat-service   ^/ws/chat/(.*)$   -> /$1
 * So the service handles  /rooms/{id}/messages  and  /rooms/{id}  (WS).
 *
 * The message object this app renders:
 *   { id, content, sender_username, sent_at }
 * `id` must be stable and unique — the UI dedupes the socket echo against the
 * POST response by id. `sent_at` is ISO-8601 with a timezone.
 * Sending `room_id` / `sender_id` too is fine, the UI just ignores them.
 */
const ROOMS = "/api/chat/rooms";

/**
 * GET /rooms/{roomId}/messages?limit&before   (chat-service)
 * Used by: useRoomMessages -> RoomView message list.
 *
 * `before` is a MESSAGE ID, for paging upwards (fetch messages older than it).
 * Response: [ message ] ordered OLDEST -> NEWEST. The UI renders the array
 *           top-to-bottom and does not sort it.
 * Errors:   403 for non-members of the room.
 */
export async function listMessages(roomId, { limit = 50, before } = {}) {
  return request(
    `${ROOMS}/${roomId}/messages${buildQuery({ limit, before })}`,
    {},
    "Failed to load messages",
  );
}

/**
 * POST /rooms/{roomId}/messages   (chat-service)
 * Used by: MessageComposer, via useRoomMessages.send.
 *
 * Body:     { content }  — sender is taken from the session, never the body.
 * Response: 201 + the CREATED MESSAGE, id included. The UI appends this
 *           response optimistically, so returning an empty body means the
 *           message will not show until a reload.
 *
 * The service should also broadcast the same message over the room socket;
 * the sender's own copy is deduped by id, so a self-echo is harmless.
 */
export async function sendMessage(roomId, content) {
  return request(
    `${ROOMS}/${roomId}/messages`,
    { method: "POST", ...jsonBody({ content }) },
    "Failed to send message",
  );
}

/**
 * WS /ws/chat/rooms/{roomId}   (chat-service)
 *
 * Same origin as the page, so the session cookie rides along on the handshake
 * automatically — there is no token in the URL and no subprotocol. The service
 * must authenticate the cookie during the handshake and reject non-members.
 *
 * Requires the gateway's /ws/chat/ block to forward the Upgrade/Connection
 * headers with proxy_http_version 1.1.
 */
export function roomSocketUrl(roomId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/chat/rooms/${roomId}`;
}

/**
 * Opens a room socket that survives an expired access token: the server closes
 * with 1008, we refresh the cookie, then reconnect with backoff.
 *
 * FRAME CONTRACT (server -> client), JSON text frames:
 *
 *   { "type": "message.created", "message": { id, content,
 *                                             sender_username, sent_at } }
 *
 * That is the only frame the UI currently handles; anything else is ignored,
 * so new event types can be added without breaking this client. Non-JSON
 * frames are dropped silently.
 *
 * Client -> server: nothing. Sending is done over REST. The returned `send`
 * exists for future use and is unused today.
 *
 * Close codes: 1000 = clean (we stay closed). Anything else triggers a
 * refresh + reconnect with exponential backoff capped at 15s.
 */
export function openRoomSocket(roomId, { onMessage, onStatus } = {}) {
  let socket = null;
  let timer = null;
  let attempt = 0;
  let disposed = false;

  const connect = () => {
    if (disposed) return;

    onStatus?.("connecting");
    socket = new WebSocket(roomSocketUrl(roomId));

    socket.onopen = () => {
      attempt = 0;
      onStatus?.("open");
    };

    socket.onmessage = (event) => {
      try {
        onMessage?.(JSON.parse(event.data));
      } catch {
        // ignore frames that aren't JSON
      }
    };

    socket.onerror = () => onStatus?.("error");

    socket.onclose = async (event) => {
      if (disposed) return;
      onStatus?.("closed");

      // A rejected handshake (expired cookie) surfaces to the browser as an
      // abnormal 1006 close, not the server's 1008 -- refresh on any
      // unexpected close so a stale access token can't loop forever.
      if (event.code !== 1000) {
        try {
          await refreshSession();
        } catch {
          return; // session is gone for good; App will bounce to /auth
        }
      }

      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
      timer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    send(payload) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    },
    close() {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
