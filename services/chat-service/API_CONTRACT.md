# chat-service API Contract

This is what chat-service **actually** exposes today, verified against the
running stack (not aspirational — every example below was captured from a
real request/response). If you're integrating the frontend, this is the
ground truth; `frontend/app/mock-server/main.py` is the old FastAPI mock and
its contract (`/api/rooms/{id}/chat`, `/api/rooms/{id}/members`,
`/api/direct-messages`) does **not** match this service.

All requests go through the gateway at `http://localhost:8000` — chat-service
is never reachable directly from the browser (`nginx.conf` only exposes
`:8000`; chat-service's own port `8081` is internal to the Docker network).

---

## Authentication

Every endpoint below (REST and WebSocket) requires a JWT **issued by
identity-service** — chat-service never issues its own tokens and has no
login/register endpoints of its own.

1. Get a token from identity-service, through the gateway:
   ```
   POST /api/users/register   { username, email, password, displayName? }
   POST /api/users/login      { identifier, password }   // identifier = username or email
   ```
   Response (both): `{ "tokenType": "Bearer", "accessToken": "<jwt>", "user": {...} }`

2. **REST calls** — send it as a header:
   ```
   Authorization: Bearer <accessToken>
   ```
   Missing or invalid → `401`. There is currently **no other way** to
   authenticate a REST call — no cookies, no session.

3. **WebSocket connect** — the header approach doesn't work here, because the
   browser's native `WebSocket` API cannot set custom headers on the
   handshake request. Use a query parameter instead:
   ```
   ws://localhost:8000/ws/chat?token=<accessToken>
   ```
   (`Authorization: Bearer` header is also accepted if your WS client can set
   one — useful for non-browser testing — but query param is the only option
   from real browser JS.)

Token expiry is whatever identity-service set (`exp` claim) — chat-service
just checks it's valid and unexpired, it doesn't refresh anything.

---

## REST Endpoints

### `GET /api/rooms`
List every room (DM or group) the authenticated caller is a member of.

**Auth:** required.
**Response `200`:**
```json
[
  {
    "id": "6a76064b586b1c7be1750adb",
    "type": "DM",
    "name": null,
    "memberIds": ["a07abeb0-8b70-4e2c-9e4c-1f2040f0e858", "a215c5f8-d810-4518-ad4c-8d551eb6dfc4"],
    "createdAt": "2026-08-07T16:22:35.744Z"
  },
  {
    "id": "6a76064b586b1c7be1750adc",
    "type": "GROUP",
    "name": "contract-test",
    "memberIds": ["a215c5f8-d810-4518-ad4c-8d551eb6dfc4", "a07abeb0-8b70-4e2c-9e4c-1f2040f0e858"],
    "createdAt": "2026-08-07T16:22:35.806Z"
  }
]
```
- `name` is always `null` for `type: "DM"`.
- `memberIds` are identity-service user **UUIDs** — chat-service does not
  know usernames/display names. See [Known Gaps](#known-gaps).

---

### `POST /api/rooms/dm`
Get-or-create a 1:1 room with another user. Idempotent — calling it again
with the same pair returns the **same** room, doesn't create a duplicate
(dedup is on the sorted pair of member IDs, so it doesn't matter who calls it
first).

**Auth:** required. The caller is always one side of the DM (taken from the
JWT, not from the request body).

**Request body:**
```json
{ "targetUserId": "a07abeb0-8b70-4e2c-9e4c-1f2040f0e858" }
```
`targetUserId` must be non-blank or you get `400`.

**Response `200`:** same `Room` shape as above, `type: "DM"`.

---

### `POST /api/rooms/group`
Create a group room. Not idempotent — every call creates a new room, even
with identical `name`/`memberIds`.

**Auth:** required. The caller is automatically added as a member — you do
**not** need to include your own id in `memberIds`.

**Request body:**
```json
{ "name": "contract-test", "memberIds": ["a07abeb0-8b70-4e2c-9e4c-1f2040f0e858"] }
```
`name` non-blank, `memberIds` non-empty, or `400`.

**Response `201`:**
```json
{
  "id": "6a76064b586b1c7be1750adc",
  "type": "GROUP",
  "name": "contract-test",
  "memberIds": ["a215c5f8-d810-4518-ad4c-8d551eb6dfc4", "a07abeb0-8b70-4e2c-9e4c-1f2040f0e858"],
  "createdAt": "2026-08-07T16:22:35.806379865Z"
}
```

---

### `GET /api/rooms/{roomId}/messages?page=0&size=50`
Message history for a room, **newest first**.

**Auth:** required, and the caller must be a member of `roomId` or this
returns `403` (not just an empty list — membership is enforced, not silently
filtered).

**Query params:** `page` (default `0`), `size` (default `50`) — standard
offset pagination.

**Response `200`:**
```json
[
  {
    "id": "6a75d613586b1c7be1750ad4",
    "roomId": "6a75d60a586b1c7be1750ad3",
    "senderId": "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
    "content": "hello",
    "sentAt": "2026-08-07T12:56:51.179Z"
  }
]
```
Note: **no `senderUsername` field here** — history entries only carry
`senderId` (the raw user UUID). The live WebSocket broadcast *does* include
`senderUsername` (see below) because it's available from the sender's JWT at
broadcast time; history reads from MongoDB, which only ever stored `senderId`.
If the UI needs a display name in history, it has to resolve `senderId` →
username itself (via identity-service), same as for `memberIds`.

`roomId` that doesn't exist → `404`. `roomId` that exists but caller isn't a
member of → `403`.

---

## Error response shape

All errors (`400`, `401`, `403`, `404`) use Spring Boot's default shape —
this is not a custom error format:
```json
{
  "timestamp": "2026-08-07T16:22:35.761+00:00",
  "status": 403,
  "error": "Forbidden",
  "path": "/api/rooms/6a76064b586b1c7be1750adb/messages"
}
```
There's no `message` field with a human-readable reason — just `status` +
`error`. Branch UI behavior on the numeric `status`, not on parsing `error`.

---

## WebSocket — `/ws/chat`

**Connect:** `ws://localhost:8000/ws/chat?token=<accessToken>`

- Invalid/missing token → the handshake never completes (no `101`), the
  connection attempt fails outright. No specific error message is sent back
  on the socket, because there is no socket yet at that point.
- On success, the connection just opens — no "welcome" frame, no ack.

**Send** (client → server), one JSON object per text frame:
```json
{ "roomId": "6a75d60a586b1c7be1750ad3", "content": "hello" }
```
- `senderId` is **never** part of the payload — it's taken from your JWT,
  can't be spoofed by sending a different value.
- If `roomId`/`content` missing, `content` blank, payload isn't valid JSON,
  or you're not a member of `roomId`: the message is **silently dropped**.
  No error frame is sent back to you — this is a deliberate choice (see
  `ChatWebSocketHandler.handleTextMessage`), so if a send appears to do
  nothing, check `docker logs chat-service` for the actual reason
  (`"Dropping malformed message"`, `"Rejected message: ... is not a member"`,
  etc.) rather than expecting client-visible feedback today.

**Receive** (server → client), broadcast to every online session of every
room member — **including the sender's own other connections**:
```json
{
  "id": "6a75d613586b1c7be1750ad4",
  "roomId": "6a75d60a586b1c7be1750ad3",
  "senderId": "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
  "senderUsername": "med_curl",
  "content": "hello",
  "sentAt": "2026-08-07T12:56:51.179Z"
}
```
- Only delivered to members who are **currently connected**. There is no
  push notification / offline queue — if a member isn't connected to
  `/ws/chat` at send time, they simply don't get this frame (they'll see it
  later via `GET /api/rooms/{roomId}/messages`, since it's persisted
  regardless of who's online).
- One user can have multiple simultaneous sessions (multiple tabs/devices) —
  all of them receive the broadcast.

---

## Known Gaps (not implemented — do not assume these exist)

- **`GET /api/rooms/{id}/members`** — does not exist. If you need a member
  list with online/offline status, `Room.memberIds` (from `GET /api/rooms`)
  plus your own presence tracking is what's available today; there's no
  chat-service endpoint that returns member *details*.
- **`GET /api/direct-messages`** — does not exist as a distinct concept. DMs
  are just rooms with `type: "DM"` — use `GET /api/rooms` and filter by
  `type` client-side, or `POST /api/rooms/dm` to get/create one.
- **No username/display-name enrichment anywhere.** Every `memberIds`/
  `senderId` is a raw identity-service UUID. This is deliberate — chat-service
  doesn't own user data (see the project's architecture rules) — but it means
  the frontend must resolve UUIDs to display names itself, presumably via an
  identity-service endpoint (check that service's contract separately; not
  covered here).
- **No read receipts, typing indicators, online-presence broadcast, message
  editing, or message deletion.** None of these exist in any form yet.
- **No pagination cursor / "load more" beyond `page`/`size`** — plain offset
  pagination, no cursor-based infinite scroll support.

---

## Quick reference table

| Method | Path | Auth | Body | Success | Notes |
|---|---|---|---|---|---|
| POST | `/api/users/register` | none | `{username,email,password}` | `200` | identity-service, not chat-service |
| POST | `/api/users/login` | none | `{identifier,password}` | `200` | identity-service, not chat-service |
| GET | `/api/rooms` | Bearer | — | `200` | list caller's rooms |
| POST | `/api/rooms/dm` | Bearer | `{targetUserId}` | `200` | idempotent get-or-create |
| POST | `/api/rooms/group` | Bearer | `{name, memberIds[]}` | `201` | caller auto-added |
| GET | `/api/rooms/{id}/messages?page&size` | Bearer | — | `200` / `403` / `404` | newest first |
| WS | `/ws/chat?token=` | query param | JSON frames | — | see above |
