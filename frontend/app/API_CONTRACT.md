# API contract — what the frontend expects

This is the handoff document for whoever implements the backend services. The
frontend is already written against this contract; every endpoint here is
actually called by a screen, and every field listed is actually read by a
component. The same information lives in comments in `src/api/*.js` — if you
change one, change the other.

Nothing here is implemented yet. `services/` is empty, so `docker compose up`
currently fails on the `build:` steps for the services.

---

## 1. Ground rules

### Auth is cookies, not headers

There is no `Authorization` header and no token in `localStorage` anywhere in
this app. Every request goes out with `credentials: "include"`.

- Set the session cookies **HttpOnly**, `SameSite=Lax`, and `Secure` in prod.
- Read the access token from the cookie, never from a header.
- Return **401** when the access token is missing or expired.
- Return **403** for "authenticated but not allowed" — see the refresh rule below.

### The refresh dance

`src/api/http.js` wraps every authenticated request: on a **401** it calls
`POST /api/users/auth/refresh` once, then retries the original request once.
Concurrent 401s share a single refresh request.

Consequences you need to honour:

- `POST /auth/refresh` rotates the access cookie from the refresh cookie. It
  takes no body. It returns 2xx on success (body ignored) and **401** when the
  refresh token is also dead — that is what fully logs the user out.
- Do **not** answer 401 for permission errors, or every one of them costs a
  pointless refresh round-trip. Use 403.

### `POST /auth/register` must issue a session

The signup screen calls register and then goes straight into the app. There is
no follow-up login call and no email-verification step. If register does not
set the session cookies, signup lands on a blank app that immediately bounces
back to `/auth`.

### Everything is same-origin and root-relative

All URLs are `/api/...`. The SPA is served from the same origin as the nginx
gateway, which is what makes the cookies work. Do not ask the frontend to call
a service host directly — that breaks cookie auth.

### Error envelope

Any non-2xx response body should be:

```json
{ "message": "Human readable reason shown directly to the user" }
```

This string is displayed to the user verbatim (except for 5xx, which the auth
screen replaces with a generic message). `{ "detail": "..." }` is accepted as a
fallback, and a bare string body is used as-is.

### Timestamps

ISO-8601 **with** a timezone offset or a trailing `Z`. A naive
`"2026-09-06 14:03:00"` parses inconsistently across browsers and renders as an
empty string.

### Naming

Response fields are `snake_case` (`display_name`, `sent_at`,
`sender_username`, `user_id`). Request bodies likewise (`{ user_id }`).

---

## 2. Gateway routing

`gateway/nginx.conf` strips the prefix before proxying. **The paths in the
tables below are what your service sees**, not what the browser sends.

| Browser sends | Gateway | Service sees |
|---|---|---|
| `/api/users/auth/login` | identity-service | `/auth/login` |
| `/api/users/me` | identity-service | `/me` |
| `/api/users/friends/list` | identity-service | `/friends/list` |
| `/api/chat/rooms/5` | chat-service | `/rooms/5` |
| `/ws/chat/rooms/5` | chat-service | `/rooms/5` (WebSocket) |
| `/api/orgs/...` | org-service | `/...` — **reserved, unused** |
| anything else | frontend | SPA |

The `location /` catch-all must stay last. The `/ws/chat/` block forwards
`Upgrade`/`Connection` with `proxy_http_version 1.1`; without those the
handshake cannot upgrade.

---

## 3. Shared object shapes

**user** — returned by `/me`, `/by-username`, and embedded elsewhere:

```json
{
  "id": 12,
  "username": "rustc0",
  "display_name": "Mohammed",
  "bio": "…",
  "avatar": "8f3a...png",
  "status": "online",
  "friendship_id": 44,
  "friendship_status": "pending_outgoing"
}
```

- `avatar` is the stored **filename**, not a URL. `null` when unset.
- `status` ∈ `"online" | "offline" | "away"`.
- `friendship_id` / `friendship_status` are relative to the **caller** and only
  need to be present on `/by-username`. `friendship_status` ∈
  `"none" | "friends" | "pending_outgoing" | "pending_incoming"`. These drive
  which button the profile popover shows.

**room**:

```json
{
  "id": 5,
  "name": "general",
  "type": "group",
  "created_at": "...", "modified_at": "...",
  "peer": { "id": 7, "username": "zdidah", "status": "online" },
  "last_message": { "content": "hey", "sent_at": "..." }
}
```

- `type` ∈ `"dm" | "group"`.
- `peer` is **DM only** — the other member. A DM has no `name`, so without
  `peer` the sidebar has nothing to display.
- `last_message` powers the list preview. `null` for an empty room.

**member**: `{ id, username, status, role }` — `id` is the **user** id,
`role` ∈ `"owner" | "admin" | "member"`.

**message**: `{ id, content, sender_username, sent_at }` — `id` must be stable
and unique; the UI dedupes the WebSocket echo against the POST response by id.
Extra fields (`room_id`, `sender_id`) are ignored.

**friend request**: `{ id, friendship_id, sender: { id, username, avatar, status } }`

**room invite (to me)**: `{ id, room: { id, name }, inviter: { id, username } }`
**room invite (pending, per room)**: `{ id, user_id }`

---

## 4. identity-service — `/api/users/*`

### Auth (`src/api/authentication.js`)

| Method | Path | Body | Returns | Used by |
|---|---|---|---|---|
| POST | `/auth/register` | `{ username, email, password }` | 201 + user, **sets cookies** | signup form |
| POST | `/auth/login` | `{ identifier, password }` | 200, sets cookies | login form |
| POST | `/auth/logout` | — | 200, clears cookies + invalidates refresh | sidebar logout |
| POST | `/auth/refresh` | — | 200 / 401 | `http.js`, automatic |
| GET | `/me` | — | user | boot session probe, `ProfileOverlayContext` |

- `identifier` is an **email or a username** — the service decides by content.
- register: 409 on taken username/email, 422 on validation.
- login: 401 `{ "message": "Invalid credentials" }`.
- `/me`: 401 with no session. `App.jsx` treats any failure as "logged out".

### Profile (`src/api/profile.js`)

| Method | Path | Body | Returns | Used by |
|---|---|---|---|---|
| GET | `/check-username?username=` | — | `{ available: bool }` | profile editor, debounced |
| PUT | `/me` | subset of `{ display_name, username, bio }` | updated user | profile editor |
| GET | `/by-username?username=` | — | user **+ friendship fields** | profile popover |
| GET | `/avatar/{filename}` | — | image bytes | every avatar |
| POST | `/me/avatar` | multipart, file field `avatar` | updated user | avatar picker |
| DELETE | `/me/avatar` | — | updated user, `avatar: null` | remove photo |

- `PUT /me`: missing keys mean "leave unchanged", not "clear". 409 on a taken
  username.
- `check-username` fires on every keystroke (debounced, abortable) — keep it
  cheap.
- `GET /avatar/{filename}` is **authenticated** — the UI fetches it as a blob
  rather than putting it in an `<img src>`. See the caching note in §6.

### Friends (`src/api/friends.js`)

Two id types, easy to mix up: `friendId` is a **user** id, `requestId` is a
**friendship row** id.

| Method | Path | Returns | Used by |
|---|---|---|---|
| GET | `/friends/list?limit&offset` | `[ user ]` (accepted only) | friends tab, invite picker |
| GET | `/friends/requests?limit&offset` | `[ friend request ]` (**incoming**) | requests tab |
| POST | `/friends/add/{friendId}` | created pending friendship | "Add friend" |
| POST | `/friends/request/{requestId}/accept` | — | requests tab |
| POST | `/friends/request/{requestId}/decline` | — | requests tab |
| DELETE | `/friends/request/{requestId}` | — | "Cancel request" (sender side) |
| DELETE | `/friends/delete/{friendId}` | — | "Remove friend" |

- `add`: 409 if a friendship or pending request exists in **either** direction,
  400 when adding yourself.
- accept/decline: recipient only. cancel: sender only.
- `delete`: removes the accepted friendship in both directions.

---

## 5. chat-service — `/api/chat/*` and `/ws/chat/*`

### Rooms, members, invites (`src/api/rooms.js`)

| Method | Path | Body | Returns | Used by |
|---|---|---|---|---|
| GET | `/rooms?limit&offset` | — | `[ room ]` the caller belongs to, DMs included | sidebar + DM list |
| GET | `/rooms/invites?limit&offset` | — | invites **addressed to me** | invites tab |
| GET | `/rooms/{id}` | — | room | opening a room by URL |
| POST | `/rooms` | `{ name }` | 201 + room, caller = `owner` | create room |
| POST | `/rooms/dm` | `{ user_id }` | the DM room | "Send message" |
| PATCH | `/rooms/{id}` | `{ name }` | room | rename |
| DELETE | `/rooms/{id}` | — | — | delete room |
| GET | `/rooms/{id}/members` | — | `[ member ]` | members sidebar |
| POST | `/rooms/{id}/members` | `{ user_id }` | member | add a friend |
| DELETE | `/rooms/{id}/members/{userId}` | — | — | kick **and leave** |
| POST | `/rooms/{id}/members/{userId}/roles` | `{ role }` | member | role menu |
| GET | `/rooms/{id}/invites` | — | `[ { id, user_id } ]` pending **for this room** | invite picker |
| POST | `/rooms/{id}/invites` | `{ user_id }` | 201 + invite | invite |
| POST | `/rooms/invites/{inviteId}/accept` | — | joined room | invites tab |
| DELETE | `/rooms/invites/{inviteId}` | — | — | decline / revoke |

Notes:

- **Route `/rooms/invites` before `/rooms/{roomId}`**, or most routers read
  `"invites"` as a room id and 400/422 on the cast. (Or constrain `{roomId}` to
  digits.)
- `GET /rooms` must widen DMs with `peer` and `last_message`, and should be
  sorted newest-active first — the UI does not re-sort.
- `POST /rooms/dm` must be **idempotent**: return the existing DM rather than
  creating a duplicate.
- `DELETE /members/{userId}`: removing someone else requires admin/owner;
  removing yourself is always allowed (that is "leave"). The owner leaving
  should transfer ownership or delete the room — the frontend does not handle
  that case.
- `POST /roles`: owner only, `role` ∈ `"admin" | "member"` (`owner` is not
  assignable through this route).
- Authorisation is entirely yours: membership for reads, owner/admin for
  rename, delete, kick, invite, roles. 403 for non-members.

### Messages (`src/api/messages.js`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/rooms/{id}/messages?limit&before` | — | `[ message ]`, **oldest → newest** |
| POST | `/rooms/{id}/messages` | `{ content }` | 201 + **the created message** |

- `before` is a **message id**; return messages older than it (paging upwards).
- The sender comes from the session, never from the body.
- The POST response is appended optimistically — an empty body means the
  message does not appear until a reload.

### WebSocket — `/ws/chat/rooms/{roomId}`

Same origin as the page, so the session cookie rides along on the handshake.
There is no token in the URL and no subprotocol. **Authenticate the cookie
during the handshake and reject non-members.**

Server → client, JSON text frames:

```json
{ "type": "message.created",
  "message": { "id": 91, "content": "hey",
               "sender_username": "zdidah", "sent_at": "..." } }
```

That is the only frame the UI handles today; anything else is ignored, so you
can add event types without breaking this client. Non-JSON frames are dropped.

Client → server: **nothing**. Sending goes over REST. Broadcast the new message
to the room including the sender — the sender's own copy is deduped by id.

Close codes: `1000` = clean, the client stays closed. Anything else triggers a
cookie refresh and a reconnect with exponential backoff capped at 15s. Close
with `1008` on an expired token (the browser reports it as `1006`, which the
client handles the same way).

---

## 6. Open questions for the team

- **No dedicated leave endpoint.** The client passes its own user id to
  `DELETE /rooms/{id}/members/{userId}`. A `POST /rooms/{id}/leave` would be
  simpler to authorise; only `leaveRoom` in `src/api/rooms.js` would change.
- **Avatar fetching does not scale.** `useAvatarUrl` makes one authenticated
  blob request per avatar per component mount, with no cache — a 30-member list
  is 30 requests. Send a long `Cache-Control` (the filename changes whenever
  the avatar does, so it is safe to cache hard), or expose avatars on a
  public/signed URL so they can go straight into `<img src>`.
- **No OAuth in the frontend.** `docker-compose.yml` sets `GITHUB_CLIENT_ID` /
  `GITHUB_REDIRECT_URI`, but there is no GitHub button and no callback route in
  the app. Someone has to build the frontend side if that feature stays.
- **No password reset.** No "forgot password" view and no endpoint.
- **`/api/orgs` is reserved and unused.** Decide what org-service owns, or drop
  it.
- **Lists never refresh.** Rooms, DMs, friend requests and member lists load
  once on mount and only update through a manual refresh counter. If you want
  live membership/friend updates, the socket is the place to push them.
