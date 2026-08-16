# chat-service — API contract

Everything below is what the service **actually implements** today, read off the code.
Frontend should code against this document, not against `frontend/app/mock-server/main.py`
(the mock is a different, older contract and is not part of the Docker stack).

Base URL through the gateway: `http://localhost:8000`
Use **relative paths** in the frontend (`/api/rooms`), never a hardcoded origin — the SPA is
served by the same nginx that proxies the API.

---

## 1. Authentication

chat-service does not issue tokens. identity-service does. chat-service only verifies them,
using the shared `JWT_SECRET`.

### REST — `Authorization` header

Every `/api/rooms/**` request needs:

```
Authorization: Bearer <token>
```

Exempt: `/actuator/**`, `/ws/**`. Everything else without a valid token gets **401**.

```js
const token = localStorage.getItem("token");

const response = await fetch("/api/rooms", {
  headers: { Authorization: `Bearer ${token}` },
});
```

### WebSocket — `?token=` query parameter

The browser `WebSocket` constructor **cannot set request headers** — there is no API for it.
So the handshake takes the token from the query string instead:

```js
const socket = new WebSocket(`/ws/chat?token=${token}`);   // resolve to ws:// origin
```

A bad or missing token fails the handshake with **401** and the socket never opens.
(`JwtHandshakeInterceptor` also accepts an `Authorization` header, which is useful for
non-browser clients and tests, but is unreachable from browser JS.)

---

## 2. Identifiers

**All ids are strings.** MongoDB generates them (`"68b3f1c9a4e2..."`), they are not integers.
The mock's `room_id: int` does not exist here. Never do arithmetic on, sort, or `parseInt` an id.

---

## 3. What chat-service does *not* own

There is no username, avatar, or email in any response below — only `userId` / `senderId`.

identity-service owns user data. To display a member or a message author, resolve the
profile separately:

```
GET /api/users/{userId}      → identity-service
```

Cache these client-side; do not re-fetch per message.

---

## 4. REST endpoints

### `GET /api/rooms`

Every room the caller belongs to — both DMs and groups.

```json
[
  {
    "id": "68b3f1c9a4e2b10c3d5f7a01",
    "type": "GROUP",
    "name": "development",
    "ownerId": "user-1",
    "memberIds": ["user-1", "user-2"],
    "createdAt": "2026-08-10T11:20:31.442Z"
  },
  {
    "id": "68b3f1c9a4e2b10c3d5f7a02",
    "type": "DM",
    "name": null,
    "ownerId": null,
    "memberIds": ["user-1", "user-9"],
    "createdAt": "2026-08-10T11:22:04.118Z"
  }
]
```

`ownerId` is the user who created a **group**, and is `null` for DMs — a DM has no
owner, both members are equal peers. It is recorded but **not yet enforced**:
there are no privileged operations (no add/remove member, rename, or delete), so
today every member has identical rights. Do not build UI that implies otherwise
yet; rooms created before 2026-08-17 have `ownerId: null` even when they are groups.

**There is no `/api/direct-messages` endpoint.** Filter this response client-side:

```js
const dms = rooms.filter((room) => room.type === "DM");
```

For a DM, the display name is the *other* member — `memberIds.find(id => id !== myUserId)`,
then resolve via identity-service.

---

### `GET /api/rooms/{roomId}/messages?page=0&size=50`

Message history, newest-first paging. Replaces the mock's `/api/rooms/{id}/chat`.

```json
[
  {
    "id": "68b3f2...",
    "roomId": "68b3f1c9a4e2b10c3d5f7a01",
    "senderId": "user-2",
    "content": "did you finish the layout?",
    "sentAt": "2026-08-10T11:41:09.771Z"
  }
]
```

- `403` if the caller is not a member of the room
- `404` if the room does not exist

---

### `GET /api/rooms/{roomId}/members`

```json
[
  { "userId": "user-1", "online": true },
  { "userId": "user-2", "online": false }
]
```

`online` is live presence, derived from open WebSocket sessions — not a stored field.
It is accurate at request time only; it does **not** push updates. A user with no open
socket reads as offline even if they have the tab open but the socket dropped.

- `403` if the caller is not a member

---

### `POST /api/rooms/dm`

Get the existing DM room with another user, or create it. Idempotent — calling twice
returns the same room, so it is safe to call on every "open conversation" click.

```json
{ "targetUserId": "user-9" }
```

Returns `200` with the Room object.

---

### `POST /api/rooms/group`

```json
{ "name": "development", "memberIds": ["user-2", "user-3"] }
```

The caller is added automatically — do not include your own id. Returns `201` with the Room.

---

## 5. WebSocket protocol

```
ws://localhost:8000/ws/chat?token=<jwt>
```

nginx is already configured to proxy the upgrade (`gateway/nginx.conf`), with a 3600s read
timeout so idle sockets are not killed.

### Sending

```json
{ "roomId": "68b3f1c9a4e2b10c3d5f7a01", "content": "hello" }
```

Only those two fields are read. **`senderId` is never taken from the client** — it comes from
the verified JWT, so spoofing another user is not possible.

Limits, enforced server-side:

| Limit | Value | On breach |
|---|---|---|
| `content` length | 2000 characters | `ERROR` frame, `VALIDATION_FAILED` |
| `content` blank/missing | — | `ERROR` frame, `VALIDATION_FAILED` |
| Raw frame size | 16 KB | Tomcat closes the connection |
| Send rate | burst 10, then 5/sec | `ERROR` frame, `RATE_LIMITED` |

### Every server frame has a `type`

Two kinds of frame arrive on the socket. Switch on `type` before reading anything else:

```js
socket.onmessage = (event) => {
  const frame = JSON.parse(event.data);
  if (frame.type === "ERROR") return showError(frame.code, frame.message);
  appendIfNew(frame.id, frame);
};
```

### Receiving

Broadcast to every member of the room with an open socket, including the sender. So the
sender should **not** optimistically append its own message — it will come back, with the
real server id and timestamp.

```json
{
  "type": "MESSAGE",
  "id": "68b3f2...",
  "roomId": "68b3f1c9a4e2b10c3d5f7a01",
  "senderId": "user-2",
  "senderUsername": "amine",
  "content": "hello",
  "sentAt": "2026-08-10T11:41:09.771Z"
}
```

### Error frames

Sent **only to the client that caused them**, never broadcast to the room.

```json
{ "type": "ERROR", "code": "RATE_LIMITED", "message": "Too many messages, slow down" }
```

| `code` | Meaning | Suggested client behaviour |
|---|---|---|
| `INVALID_PAYLOAD` | Frame was not valid JSON for a message | Bug in the client — log it |
| `VALIDATION_FAILED` | Blank content, or over 2000 chars | Show inline, keep the text |
| `ROOM_NOT_FOUND` | No such `roomId` | Refresh the room list |
| `FORBIDDEN` | Not a member of that room | Refresh the room list |
| `RATE_LIMITED` | Sending too fast | Back off, retry after ~1s |
| `SERVER_ERROR` | Our fault | Show "message failed to send", allow retry |

One message is delivered per open socket, so the same user with two tabs receives it twice —
dedupe on `id`.

### Known limitations (backend side, mine to fix)

1. ~~Invalid messages fail silently.~~ **Fixed** — every rejection now returns an `ERROR`
   frame with a code (see the table above).
2. **`senderUsername` is inconsistent.** It is present on WebSocket frames (taken from the JWT
   claim) but absent from REST history, which returns the raw stored message. So the same
   message has a different shape depending on where it came from. Until this is fixed, resolve
   names from identity-service in both paths and ignore `senderUsername`.
3. **No delivery on reconnect.** Messages sent while a socket is closed are persisted but not
   replayed on reconnect — refetch history after reconnecting.

---

## 6. Frontend migration checklist

| File | Change |
|---|---|
| `src/api/*.js` | Drop the `http://localhost:8000` prefix — use relative paths |
| `src/api/*.js` | Add `Authorization: Bearer ${token}` to every chat call |
| `src/api/roomChat.js` | `/api/rooms/{id}/chat` → `/api/rooms/{id}/messages` |
| `src/api/directMessages.js` | Delete — filter `getRooms()` by `type === "DM"` |
| `src/api/roomMembers.js` | Response shape is now `{userId, online}`, no `username` |
| components | Room ids are strings, not numbers |
| `MessageComposer.jsx` | `handleSubmit` is a no-op — needs to send over the socket |
| new | WebSocket client: connect, dedupe on `id`, reconnect + refetch history |

---

## 7. Minimal working example

```js
const token = localStorage.getItem("token");

// history
const messages = await fetch(`/api/rooms/${roomId}/messages`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// live
const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/chat?token=${token}`;
const socket = new WebSocket(wsUrl);

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.roomId !== roomId) return;      // one socket carries all your rooms
  appendIfNew(message.id, message);
};

// send
socket.send(JSON.stringify({ roomId, content: text }));
```

Note the last point: **one socket carries every room the user is in.** There is no
subscribe/join step — the server broadcasts based on room membership in the database.
The client must route incoming frames by `roomId` itself.
