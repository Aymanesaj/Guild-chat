# chat-service API Contract

**Status (2026-09-28): implemented and tested.** This file describes what the
code does today. Change it in the same commit as any endpoint change.

chat-service stores messages and delivers them live. It owns **no** rooms,
users or membership: rooms and membership belong to **org-service**, users and
tokens to **identity-service**. Chat asks both over gRPC on every request.

## Conventions

- **Gateway prefix:** REST is reached at `/api/chat/...`; the gateway strips
  `/api/chat` before proxying. The paths below are chat's own paths.
  Example: `GET /api/chat/rooms/5/messages` → `GET /rooms/5/messages`.
- **WebSocket:** `/ws/chat` (not under `/api/chat`).
- **JSON is snake_case** everywhere: `room_id`, `created_at`, `reply_to_id`.
- **Auth (REST):** `Authorization: Bearer <access token>` on every request.
- **Ids:** room ids are integers (org-service). Message ids are 24-char hex
  MongoDB ObjectIds. User ids are UUID strings.
- **Times:** ISO-8601 UTC, e.g. `"2026-09-22T10:00:00.123Z"`.

### Error envelope

Every REST error has this shape:

```json
{ "error": { "code": "NOT_A_MEMBER", "message": "User is not a member of the room" } }
```

`VALIDATION_ERROR` adds a `details` object, field → message:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request body is invalid",
             "details": { "content": "content must be at most 4000 characters" } } }
```

Errors common to every REST endpoint:

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `Authorization: Bearer ...` header |
| 401 | `INVALID_TOKEN` | Token rejected by identity-service |
| 503 | `IDENTITY_UNAVAILABLE` | identity-service unreachable (the token could not be checked; not a 401) |
| 503 | `ORG_UNAVAILABLE` | org-service unreachable (membership could not be checked) |
| 400 | `MALFORMED_JSON` | Body is not valid JSON |
| 400 | `INVALID_PARAMETER` | A path/query value has the wrong type, e.g. `/rooms/abc/messages` |
| 404 / 405 / 415 | `NOT_FOUND` / `METHOD_NOT_ALLOWED` / `UNSUPPORTED_MEDIA_TYPE` | Unknown path, wrong method, wrong content type |
| 500 | `INTERNAL_ERROR` | Unexpected; details are logged, never returned |

## The message object

Returned by every REST endpoint and carried by every `message.*` WebSocket
event: the same JSON on both.

```json
{
  "id": "66f0c1a2b3c4d5e6f7a8b9c0",
  "room_id": 5,
  "sender_id": "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
  "reply_to_id": null,
  "content": "hello",
  "content_type": "text",
  "created_at": "2026-09-22T10:00:00.123Z",
  "edited_at": null,
  "deleted": false
}
```

- `content_type` is always `"text"` in v1.
- A deleted message keeps its place in history with `"deleted": true` and
  `"content": null`. The text never leaves the server again.
- `edited_at` is `null` until the first edit.
- Sender names and avatars are **not** included: resolve `sender_id` through
  identity-service.

## REST endpoints

### `GET /rooms/{roomId}/messages`: history

Newest first, cursor-paginated. Caller must be a member of the room.

| Query | Default | Rules |
|---|---|---|
| `limit` | 50 | 1–100 |
| `before` | none (newest page) | a message id; returns messages strictly older than it |

To load older messages, pass the `id` of the oldest message you have as
`before`. An empty array means there is nothing older. Deleted messages are
included (see above).

`200` → array of message objects.

| Status | Code | When |
|---|---|---|
| 403 | `NOT_A_MEMBER` | Caller is not in the room (checked before anything else) |
| 400 | `INVALID_LIMIT` | `limit` outside 1–100 |
| 400 | `INVALID_CURSOR` | `before` is not a valid message id |

### `POST /rooms/{roomId}/messages`: send

```json
{ "content": "hello", "reply_to_id": "66f0c1a2b3c4d5e6f7a8b9c0" }
```

- `content`: required, not blank, at most 4000 characters.
- `reply_to_id`: optional. Must be a live message in the **same** room.
- The sender is always the token's user; sender and room cannot be set in the body.

`201` → the stored message object. It is also broadcast as `message.new`,
including to the sender's own sockets (dedupe by `id`).

| Status | Code | When |
|---|---|---|
| 403 | `NOT_A_MEMBER` | Caller is not in the room |
| 400 | `VALIDATION_ERROR` | `content` blank or longer than 4000 |
| 400 | `INVALID_REPLY_ID` | `reply_to_id` is not a valid message id |
| 400 | `REPLY_NOT_FOUND` | Replied-to message does not exist |
| 400 | `REPLY_WRONG_ROOM` | Replied-to message is in another room |
| 400 | `REPLY_DELETED` | Replied-to message was deleted |

### `GET /messages/{messageId}`: one message

`200` → message object (deleted messages included, content hidden).

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MESSAGE_ID` | Not a valid message id |
| 404 | `MESSAGE_NOT_FOUND` | Unknown id **or** caller is not in the message's room (same answer on purpose, so ids cannot be probed) |

### `PATCH /messages/{messageId}`: edit

```json
{ "content": "hello, fixed" }
```

Sender only, and only while the message is younger than **15 minutes**
(at exactly 15:00 it is refused). Same `content` rules as sending.

`200` → the updated message object, also broadcast as `message.edited`.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MESSAGE_ID` / `VALIDATION_ERROR` | Bad id / bad content |
| 404 | `MESSAGE_NOT_FOUND` | Unknown, or caller not in the room |
| 403 | `NOT_SENDER` | Caller did not send it |
| 403 | `MESSAGE_DELETED` | Message is deleted (also if a delete lands during the edit) |
| 403 | `EDIT_WINDOW_EXPIRED` | Older than 15 minutes |

### `DELETE /messages/{messageId}`: soft delete

Allowed for the sender, or a room `OWNER`/`ADMIN`. Deleting an already
deleted message is not an error.

`204` → no body. Only the **first** delete is broadcast as `message.deleted`.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MESSAGE_ID` | Not a valid message id |
| 404 | `MESSAGE_NOT_FOUND` | Unknown, or caller not in the room |
| 403 | `NOT_ALLOWED` | Caller is neither the sender nor an owner/admin (checked even if already deleted) |

### `GET /presence?ids=a,b,c`: online status

Any authenticated user may ask about any user. `ids` is comma-separated
(`?ids=a&ids=b` also works); blanks and duplicates are ignored.

```json
{ "a": "online", "b": "offline", "c": "offline" }
```

A user is `online` while they have at least one open `/ws/chat` socket, and
for 5 seconds after the last one closes (so a page refresh does not flicker).

| Status | Code | When |
|---|---|---|
| 400 | `MISSING_IDS` | No ids given |
| 400 | `TOO_MANY_IDS` | More than 100 distinct ids |

## WebSocket: `/ws/chat`

One socket per browser tab, shared by every room. The frontend opens it at
login and keeps it until logout: an open socket is what makes a user "online".

### Handshake

```
wss://<host>/ws/chat?token=<access token>
```

The token goes in the query string because browsers cannot set headers on a
WebSocket. It is checked once, at the handshake.

| Response | When |
|---|---|
| `101` | Connected |
| `401` | No token, or token rejected |
| `503` | identity-service unreachable |

Browsers do not expose the handshake status: a rejected handshake appears as
a close with code `1006`. Refresh the token, then reconnect.

The server closes sockets idle for more than 10 minutes, and closes the
socket (code `1009`) if a client frame is larger than 64 KB.

### Frames

Every frame, in both directions, is JSON:

```json
{ "event": "<name>", "data": { ... } }
```

### Client → server

| Event | Data | Effect |
|---|---|---|
| `subscribe` | `{ "room_id": 5 }` | Start receiving the room's live events. Membership is checked. Subscribing twice is harmless. |
| `unsubscribe` | `{ "room_id": 5 }` | Stop receiving them. Always allowed. |

`room_id` must be a JSON **integer**: `"5"` (a string) and `5.5` are rejected.
Subscriptions live on the socket: after every reconnect, subscribe again.

### Server → client

| Event | Data | When |
|---|---|---|
| `message.new` | message object | A message was posted in a subscribed room |
| `message.edited` | message object | A message was edited |
| `message.deleted` | message object (`deleted: true`, `content: null`) | A message was deleted |
| `error` | `{ "code": "...", "message": "..." }` | A client frame was refused (see below). The socket stays open. |

Clients should ignore events they don't know, so new ones can be added.

### `error` frame codes

| Code | When |
|---|---|
| `INVALID_JSON` | Frame is not valid JSON |
| `MISSING_EVENT` | No `event` field |
| `UNKNOWN_EVENT` | `event` is not `subscribe` / `unsubscribe` |
| `MISSING_ROOM_ID` | No `data.room_id` |
| `INVALID_ROOM_ID` | `room_id` is not an integer |
| `NOT_A_MEMBER` | Subscribe refused: not a member of the room |
| `ORG_UNAVAILABLE` | Subscribe refused: org-service unreachable, try again |

### Not implemented (v1)

- Sending messages over the socket: send with `POST`, receive over the socket.
- `typing` events: dropped from v1 scope (2026-09-22).
- `presence` push events: poll `GET /presence` instead.

### Known limitations

- A user removed from a room keeps receiving that room's live events until
  their socket reconnects. REST refuses them immediately.
- A socket is not closed when its token expires.
- Subscriptions and presence are in memory: one chat-service instance only.

## Internal

| Method | Path | Notes |
|---|---|---|
| GET | `/actuator/health` | Docker healthcheck. Not routed by the gateway. |
| GET | `/actuator/prometheus` | Metrics scrape. Not routed by the gateway. |
