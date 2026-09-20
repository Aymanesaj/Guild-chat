# Frontend integration: status and TODOs

## How it works now

```
Browser ──► nginx :8000
             ├─ /api/users/*       ─► identity-service   (auth, profiles, friends)
             ├─ /api/orgs/rooms/*  ─► org-service        (rooms, DMs, members, roles)
             └─ /api/rooms/*, /ws  ─► chat-service       (messages, being reworked by its owner)
```

- **Auth.** Login and register return `accessToken` and `refreshToken`. The frontend stores them and sends `Authorization: Bearer <accessToken>` on every request, refreshing through `POST /api/users/auth/refresh` before the token expires.
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

## identity-service TODO

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

## org-service

### Fixed on the backend — frontend work still open

**1. Changing a member's role no longer returns `401`.** ✅ backend · ⬜ frontend

Both causes are gone: the `@Size(max = 100)` on the `RoleName` enum in `UpdateMemberRoleRequest` was dropped, and `JwtAuthenticationFilter` no longer wraps `filterChain.doFilter(...)` in its `try/catch`, so exceptions from further down stop surfacing as 401s.

`PATCH /rooms/{roomId}/members/{userId}/roles` is therefore usable now. The frontend client already exists — `assignRole(roomId, userId, role)` in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js) — but **nothing calls it**: there is no promote/demote control in the UI.

To finish it: add the action to the member row in [`src/components/rooms/MemberItem.jsx`](../frontend/app/src/components/rooms/MemberItem.jsx), next to the existing kick button, shown under the same owner/admin check `MembersSidebar` already computes (`currentUserRole`). Note `OWNER` can't be assigned — only `ADMIN` and `MEMBER`.

**2. `RoomResponse` now carries `userIdIfDm`.** ✅ backend · ⬜ frontend

The DM's other participant is returned directly, so the per-DM member lookup is no longer needed.

The frontend **does not read the field yet**. `withPeers()` in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js) still issues one `GET /rooms/{id}/members` per DM to find the peer — an N+1 on every `getRooms()` call, which is also what `listDmConversations()` and the sidebar are built on.

To finish it: read `room.userIdIfDm` in `normalizeRoom()` and let `withPeers()` use it, falling back to the member lookup only when the field is absent. The existing `resolveUsers()` batch call still turns the ID into a name/avatar, so only the per-room fetch goes away. The stale comment above `withPeers()` ("RoomResponse carries no members") should go with it.

### Still open

**3. Nice to have:** `limit` and `offset` on `GET /rooms`. The frontend still pages the list client-side in `page()` in [`src/api/rooms.js`](../frontend/app/src/api/rooms.js).
