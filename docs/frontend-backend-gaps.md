# Frontend integration: status and TODOs

## How it works now

```
Browser ──► nginx :8000
             ├─ /api/users/*       ─► identity-service   (auth, profiles, friends)
             ├─ /api/orgs/rooms/*  ─► org-service        (rooms, DMs, members, roles)
             └─ /api/rooms/*, /ws  ─► chat-service       (messages, being reworked by its owner)
```

- **Auth.** `POST /api/users/login` and `/register` return `accessToken` and `refreshToken`. The frontend stores them and sends `Authorization: Bearer <accessToken>` on every request, refreshing through `POST /api/users/auth/refresh` before the token expires.
- **User IDs.** org-service returns bare user UUIDs. The frontend turns them into names and avatars with identity's `GET /api/users/{id}`.
- **Unfinished UI stays visible.** If a feature needs an endpoint that doesn't exist yet, the UI still shows it. Using it shows a message naming the endpoint it needs (for example *"Not available yet: needs identity-service: GET /by-username"*). The list lives in [`frontend/app/src/api/features.js`](../frontend/app/src/api/features.js).

## Done on the frontend

- [x] Register, login, logout, and a session that survives a page reload, with silent token refresh
- [x] Profile: view, edit (display name, username, bio), upload an avatar
- [x] Friends: list, remove, **Incoming** requests (accept or decline), **Sent** requests (cancel)
- [x] Rooms (org-service): create, list, leave, view members with roles
- [x] Room members: owners and admins add friends directly (no invites) and kick members
- [x] DMs (org-service): open or create one, list them with the other person's name
- [x] Shared UI layer: design tokens in [`src/index.css`](../frontend/app/src/index.css) and reusable components in [`src/components/ui/`](../frontend/app/src/components/ui/) (Button, IconButton, Avatar, StatusDot, Card, Input, Tabs, Feedback, ConfirmDialog, Skeleton). New UI should compose these rather than redefine buttons/avatars per file. `ConfirmDialog` also replaced the last `window.confirm`/`window.alert` calls.

---

## identity-service TODO [DONE]

**1. Find a user by username.** This is the most important one: without it there's no way to add a new friend.

```
GET /by-username?username=<name>   →  200 UserResponse  |  404
```

It powers the **Friends → Add** tab.

**2. Check whether a username is taken.**

```
GET /check-username?username=<name>   →  200 { "available": true | false }
```

It powers the live "available / taken" hint while editing your profile.

**3. Remove your avatar.**

```
DELETE /me/avatar   →  200 UserResponse (avatarUrl: null)
```

**4. Return `401` instead of `403` for a missing or expired token.**

Spring's default entry point returns 403. The frontend works around it, but 401 is the correct status.

---

## org-service TODO

**Nice to have:** `limit` and `offset` on `GET /rooms`. The frontend pages the list client-side in `page()` for now.

---

## My TODOs (frontend)

Nothing here is blocked — the backend is ready for all of it.

**1. Use `userIdIfDm` instead of the per-DM member lookup.**

`withPeers()` in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js) still fires one `GET /rooms/{id}/members` per DM to find the peer — an N+1 on every `getRooms()`, which the sidebar and `listDmConversations()` both sit on. org-service now returns the peer directly on `RoomResponse`.

Read `room.userIdIfDm` in `normalizeRoom()` and use it in `withPeers()`, falling back to the member lookup only when it's absent. `resolveUsers()` still batches the ID into a name/avatar, so only the per-room fetch goes away. Delete the stale comment above `withPeers()` ("RoomResponse carries no members").

**2. Add a promote/demote control.**

`assignRole(roomId, userId, role)` exists in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js) and nothing calls it — the 401 bug that blocked it is fixed.

Put the action on the member row in [`src/components/rooms/MemberItem.jsx`](../frontend/app/src/components/rooms/MemberItem.jsx) next to the kick button, behind the owner/admin check `MembersSidebar` already computes (`currentUserRole`). `OWNER` can't be assigned — only `ADMIN` and `MEMBER`.

**3. Surface the socket connection status.**

`useRoomMessages` tracks `connection` and returns it, but [`RoomView.jsx`](../frontend/app/src/components/rooms/RoomView.jsx) destructures only `{ messages, state, sending, send }`, so a dropped socket is invisible. Show a reconnecting banner in the room header.

**4. Room settings: rename and delete.**

`getRoom`, `updateRoom` and `deleteRoom` are written in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js) and wired to nothing. Owner-only, and `ConfirmDialog` already exists for the delete.

**5. When the identity endpoints land**, clear the matching entry in [`src/api/features.js`](../frontend/app/src/api/features.js) (set it to `null`) and the disabled UI turns itself on: Friends → Add, the live username hint, and remove-avatar (`deleteAvatar()` is already written). Drop the 403-for-401 workarounds in `http.js` / `tokens.js` once that one is fixed too.
