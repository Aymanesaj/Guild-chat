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
  "deleted": false,
  "system": null
}
```

- `content_type` is `"text"` for messages people send, or `"system"` for room
  events (see below).
- A deleted message keeps its place in history with `"deleted": true` and
  `"content": null`. The text never leaves the server again.
- `edited_at` is `null` until the first edit.
- `system` is `null` on every ordinary message.
- Sender names and avatars are **not** included: resolve `sender_id` through
  identity-service.

### System messages (room events)

What happened in a room (someone joined, left, was removed, got a new role, the
room was renamed) is part of its history. These lines come back with
`GET /rooms/{roomId}/messages` in their place between ordinary messages, and
arrive live exactly like a new message: `message.new` for sockets subscribed to
the room, and `room.activity` with `change: "new"` for list previews.

```json
{
  "id": "66f0c1a2b3c4d5e6f7a8b9c1",
  "room_id": 5,
  "sender_id": null,
  "reply_to_id": null,
  "content": null,
  "content_type": "system",
  "created_at": "2026-10-22T10:00:00.123Z",
  "edited_at": null,
  "deleted": false,
  "system": {
    "type": "MEMBER_KICKED",
    "actor_id": "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
    "target_id": "b7c1d2e3-0000-4000-8000-000000000002",
    "role": null,
    "previous_role": null,
    "name": null,
    "previous_name": null
  }
}
```

**How to tell them apart:** `content_type === "system"` (equivalently,
`system !== null`). A system message has **no sender and no content**: render
it as a centered line, not a chat bubble, and build the sentence from `system`.

All 7 keys of `system` are always present; the ones a type does not use are
`null`. User ids are UUIDs: resolve names through identity-service, as for
`sender_id`, and **when rendering**, not when storing, because usernames change.

| `type` | `actor_id` | `target_id` | Other fields | Suggested sentence |
|---|---|---|---|---|
| `ROOM_CREATED` | creator | `null` | `name` | **{actor}** created the room "{name}" |
| `MEMBER_JOINED` | who added | who was added | none | **{actor}** added **{target}** |
| `MEMBER_LEFT` | the person leaving | same as `actor_id` | none | **{actor}** left |
| `MEMBER_KICKED` | who removed | who was removed | none | **{actor}** removed **{target}** |
| `OWNERSHIP_TRANSFERRED` | the previous owner | the new owner | `role: "OWNER"`, `previous_role` (`"ADMIN"` or `"MEMBER"`) | **{target}** is now the owner |
| `ROLE_CHANGED` | who changed it | whose role changed | `role`, `previous_role` (`OWNER` / `ADMIN` / `MEMBER`) | **{actor}** made **{target}** {role} (was {previous_role}) |
| `ROOM_RENAMED` | who renamed | `null` | `name`, `previous_name` (may be `null`) | **{actor}** renamed the room to "{name}" |

Rules for the client:

- **Use "you"** when `actor_id` or `target_id` is the current user ("You
  removed Bob", "Alice made you ADMIN").
- **Unknown `type`:** new types may be added later. Do not crash: render a
  neutral line ("Room updated") or skip it.
- **Order:** when an owner leaves, `MEMBER_LEFT` comes first, then
  `OWNERSHIP_TRANSFERRED`, as two separate messages.
- **Group rooms only:** DMs never contain system messages.
- **Previews:** in a room list, `room.activity` can carry a system message.
  Show the same sentence (shortened if needed) instead of `content`, which is
  `null`. A `MEMBER_LEFT` sends no `room.activity`; the remaining members get
  `room.updated` instead and refetch.
- **They cannot be edited, deleted or replied to.** Hide those actions on system
  messages. The server refuses them anyway with `SYSTEM_MESSAGE` (edit, delete)
  and `REPLY_SYSTEM` (send with this `reply_to_id`).
- **Dedupe by `id`**, as for any message. The server stores and sends each room
  event once, even if it receives it twice.
- **When it happened:** `created_at` is when the change happened in
  org-service. History order is the order chat stored them, which is the same
  in practice.
- A user who was **removed** does not see their own `MEMBER_KICKED` line: they
  are unsubscribed and get `room.removed` instead.

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
| 400 | `REPLY_SYSTEM` | Replied-to message is a system message |

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
| 403 | `SYSTEM_MESSAGE` | It is a system message (checked before the sender) |
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
| 403 | `SYSTEM_MESSAGE` | It is a system message: nobody can delete it, owners included |
| 403 | `NOT_ALLOWED` | Caller is neither the sender nor an owner/admin (checked even if already deleted) |

### `GET /presence?ids=a,b,c`: online status

Any authenticated user may ask about any user. `ids` is comma-separated
(`?ids=a&ids=b` also works); blanks and duplicates are ignored.

```json
{ "a": "online", "b": "offline", "c": "offline" }
```

A user is `online` while they have at least one open `/ws/chat` socket, and
for 5 seconds after the last one closes (so a page refresh does not flicker).
This REST snapshot remains available; the frontend uses WebSocket presence
subscriptions instead of polling it.
See the [presence guide](../../docs/PRESENCE.md) for the backend lifecycle,
frontend subscriptions, reconnect handling and validation commands.

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
| `presence.subscribe` | `{ "user_ids": ["a", "b"] }` | Watch users and receive a `presence.snapshot`. Any authenticated user may watch anyone. Repeat subscriptions are harmless and return another snapshot. |
| `presence.unsubscribe` | `{ "user_ids": ["a", "b"] }` | Stop watching these users on this socket. |

`room_id` must be a JSON **integer**: `"5"` (a string) and `5.5` are rejected.
Subscriptions live on the socket: after every reconnect, subscribe again.
Presence frames accept 1–100 distinct nonempty string IDs; larger lists can
be subscribed in batches. Disconnecting clears all presence subscriptions.

### Server → client

| Event | Data | When |
|---|---|---|
| `presence.snapshot` | `{ "statuses": { "a": "online", "b": "offline" } }` | Immediately after a presence subscription, for the requested IDs |
| `presence.changed` | `{ "user_id": "a", "status": "online" }` | A watched user opens their first socket, or becomes `offline` 5 seconds after their last socket closes |
| `message.new` | message object | A message was posted in a subscribed room |
| `message.edited` | message object | A message was edited |
| `message.deleted` | message object (`deleted: true`, `content: null`) | A message was deleted |
| `error` | `{ "code": "...", "message": "..." }` | A client frame was refused (see below). The socket stays open. |

Clients should ignore events they don't know, so new ones can be added.
Presence changes only reach sockets watching that user. Extra tabs do not
publish duplicate online events. Reconnecting within the grace period cancels
the offline notification. Restoring subscriptions after a reconnect returns
fresh snapshots to recover changes missed while disconnected.

#### User events (no subscription needed)

Sent to **every open socket of the affected user**, whatever room is open (or
none). They keep room lists and DM previews live without polling.

| Event | Data | When |
|---|---|---|
| `room.added` | `{ "room_id": 5 }` | You can now see this room: you created it, were added to it, or someone opened a DM with you |
| `room.removed` | `{ "room_id": 5 }` | You can no longer see it: you left, were kicked, or it was deleted |
| `room.updated` | `{ "room_id": 5 }` | A room you are in changed: renamed, a member joined or left, or a role changed |
| `room.activity` | `{ "room_id": 5, "change": "new" \| "edited" \| "deleted", "message": <message object> }` | A message was sent, edited or deleted in any room you are in, the sender included |

The `room.added` / `room.removed` / `room.updated` frames carry only the id:
refetch the list over REST (org-service), which applies its own permission
rules. org-service publishes JSON through RabbitMQ after its transaction commits.
See [the room-event contract and reliability limits](../../docs/room-events.md).

`room.activity` is sent alongside `message.*`, not instead of it: a client with
the room open and subscribed receives both. It can arrive slightly before or
after the matching `message.*`.

#### Friendship events (no subscription needed)

Sent to **every open socket** of the users involved. `user_id` is always the
**other** person, never you. Both ids are UUID strings.

| Event | Who receives it | `data` | What the client should do |
|---|---|---|---|
| `friend.request.received` | The addressee | `{ "friendship_id": "<uuid>", "user_id": "<requester>" }` | Refetch requests (`GET /api/users/friends/requests` → `{ incoming, outgoing }`); optionally show a toast |
| `friend.request.sent` | The requester (their **other** tabs and devices; the tab that sent it already knows) | `{ "friendship_id": "<uuid>", "user_id": "<addressee>" }` | Refetch requests (same endpoint, `outgoing`) |
| `friend.added` | **Both** users | `{ "friendship_id": "<uuid>", "user_id": "<the other user>" }` | Refetch friends (`GET /api/users/friends`) and requests; `presence.subscribe` to `user_id` |

Like `room.*`, these frames carry ids only: **refetch over REST**, where
identity-service applies its own rules. Do not build list entries from the
frame. identity-service publishes them through RabbitMQ after its database write;
chat-service forwards them.

Rules for handling them:

- **Idempotent:** the same frame can arrive twice (broker redelivery). A refetch
  handles that for free.
- **Not sent yet:** a request being **declined** or a friend being **removed**
  produces no frame today. Those lists change only on the next refetch.
  New event names will be added later. Ignore unknown events, as the client
  already does.
- The `friendship_id` is identity's friendship id, the same `id` the
  `/friends/requests` endpoints return.

All of these are best effort. Events sent while a socket is down are lost, so
**refetch after every reconnect**.

### `error` frame codes

| Code | When |
|---|---|
| `INVALID_JSON` | Frame is not valid JSON |
| `MISSING_EVENT` | No `event` field |
| `UNKNOWN_EVENT` | `event` is not a supported room or presence subscription event |
| `INVALID_USER_IDS` | `data.user_ids` is not a nonempty array of nonempty strings |
| `TOO_MANY_IDS` | More than 100 distinct presence user IDs in one frame |
| `MISSING_ROOM_ID` | No `data.room_id` |
| `INVALID_ROOM_ID` | `room_id` is not an integer |
| `NOT_A_MEMBER` | Subscribe refused: not a member of the room |
| `ORG_UNAVAILABLE` | Subscribe refused: org-service unreachable, try again |

### Not implemented (v1)

- Sending messages over the socket: send with `POST`, receive over the socket.
- `typing` events: dropped from v1 scope (2026-09-22).

### Known limitations

- A user removed from a room is unsubscribed from it when org's `room.removed`
  arrives. If that event is lost, they keep receiving the room's live events
  until their socket reconnects. REST refuses them immediately either way.
- A socket is not closed when its token expires.
- Subscriptions and presence are in memory: one chat-service instance only.
- `room.activity` uses a member list cached in memory per room. It is
  refreshed when org reports a change to that room. If that report is lost
  (for example, Org publication fails after commit), a removed member may keep receiving that
  room's previews until the room changes again or chat restarts.

## Internal

| Method | Path | Notes |
|---|---|---|
| GET | `/actuator/health` | Docker healthcheck. Not routed by the gateway. |
| GET | `/actuator/prometheus` | Metrics scrape. Not routed by the gateway. |
| AMQP | `guildchat.room-events` → `guildchat.chat-service.room-events` | Durable direct exchange/queue, routing key `room.changed`. JSON contract: [room events](../../docs/room-events.md). |
