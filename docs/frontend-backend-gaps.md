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

## org-service TODO

**1. Bug: changing a member's role always returns `401`.**

`PATCH /rooms/{roomId}/members/{userId}/roles` answers `401 "Unable to validate JWT token"`, even with a valid token. There are two causes:

- `@Size(max = 100)` on the `RoleName` enum in `UpdateMemberRoleRequest` makes validation throw.
- `JwtAuthenticationFilter` wraps `filterChain.doFilter(...)` in its `try/catch`, so *any* exception thrown further down comes back as a 401.

Only the token check should be inside the `try`.

**2. Include the members in DM rooms.**

`GET /rooms` doesn't say who a DM is with, so the frontend calls `GET /rooms/{id}/members` once per DM to find the other person. Adding the member IDs (or just the other user's ID) to `RoomResponse` would remove those extra calls.

**3. Nice to have:** `limit` and `offset` on `GET /rooms`. The frontend pages the list itself for now.
