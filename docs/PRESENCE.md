# Presence over the shared WebSocket

Presence now uses the existing `/ws/chat` connection for both snapshots and live
online/offline updates. The frontend no longer polls every 30 seconds.
`GET /api/chat/presence` remains available as an authenticated REST snapshot.

## What online means

A user is online while chat-service has at least one open socket for them, or
while the 5-second grace period after their last socket closes is still active.
An extra tab or device adds another socket; closing one does not make the user
offline while another remains open. Room subscriptions do not affect this status.
Presence measures an open app connection, not keyboard activity or tab focus.

## Protocol

All frames use the shared socket's `{ "event": "...", "data": { ... } }` envelope.

| Direction | Event | Data | Behavior |
|---|---|---|---|
| Client to server | `presence.subscribe` | `{ "user_ids": ["alice", "bob"] }` | Start watching these users and return their current statuses. |
| Server to client | `presence.snapshot` | `{ "statuses": { "alice": "online", "bob": "offline" } }` | Initial state for the requested users, including after reconnect. |
| Server to client | `presence.changed` | `{ "user_id": "alice", "status": "offline" }` | A watched user's online/offline state changed. |
| Client to server | `presence.unsubscribe` | `{ "user_ids": ["alice"] }` | Stop watching these users on this socket. |

Any authenticated user may watch any user, matching the existing REST endpoint's
permissions. Each request accepts 1–100 distinct nonempty string IDs. The backend
trims IDs and deduplicates them; repeated subscriptions return a fresh snapshot
without adding duplicate watchers. Invalid input returns an `error` frame with
`INVALID_USER_IDS` or `TOO_MANY_IDS`.

Presence changes reach only sockets watching the affected user. Watching someone
does not make that person online. An unknown ID has an `offline` status.

## Backend flow

1. `TokenHandshakeInterceptor` validates the access token through identity-service
   and stores the authenticated user ID in the WebSocket session.
2. `ChatWebSocketHandler.afterConnectionEstablished` calls
   `PresenceRegistry.connected(userId, sessionId)`. An offline user becomes online
   and their watchers receive `presence.changed`. Extra sockets do not publish
   duplicate online events.
3. `presence.subscribe` registers the requesting socket as a watcher, then sends
   its snapshot. Registration and snapshot delivery share the registry lock with
   state changes, preventing a transition from being lost between those steps.
4. A transport error or socket closure removes that socket's watches and calls
   `disconnected(userId, sessionId)`. Duplicate cleanup is harmless.
5. If the user's final socket closed, the registry records the disconnect time
   and schedules a task for 5 seconds later. `TimeConfig.presenceScheduler`
   provides the scheduler; cancelled tasks are removed from its queue.
6. Reconnecting during the grace period cancels the pending task and clears the
   disconnect record. If a cancelled callback is already running, it checks the
   current sockets and disconnect record before publishing anything.
7. If the grace period expires without reconnection, the task clears the pending
   state and publishes `presence.changed` with `offline`. This happens without a
   REST request. A REST read that already reports offline does not suppress the
   scheduled notification.

The registry stores open socket IDs per user, watcher sockets per watched user,
watched IDs per session, disconnect timestamps, and pending offline tasks.

## Frontend flow

`AppShell` calls `connectChat()` to keep one socket open for the authenticated
session. `usePresence(userIds)` calls `subscribeToPresence` from
`frontend/app/src/api/messages.js`; it creates no separate socket or polling timer.

```text
visible user IDs
  -> subscribeToPresence
  -> presence.subscribe on /ws/chat
  -> presence.snapshot initializes status dots
  -> presence.changed updates status dots
```

The shared module keeps `userId -> Set<handler>` so multiple views can watch the
same person. Every new listener requests a snapshot, even if that user is already
watched. Cleanup sends `presence.unsubscribe` only when the user's last listener
is removed. Lists larger than 100 IDs are split into batches.

The module dispatches both event types as `{ userId, status }`. `usePresence`
stores those updates in a `Map<userId, "online" | "offline">`. Until the first
snapshot, a user's status is unknown. Changing the watched IDs clears the map;
unmounting removes the hook's listeners.

After every socket open, the client restores all room and presence subscriptions.
Presence subscriptions return fresh snapshots, recovering changes missed while
disconnected. Until then, the hook retains its last known statuses. Callbacks
from an older socket are ignored so a late frame cannot overwrite current state.
Logout clears subscriptions and reconnect timers and closes the socket.

## Retained REST endpoint

```http
GET /api/chat/presence?ids=alice,bob
Authorization: Bearer <access-token>
```

```json
{ "alice": "online", "bob": "offline" }
```

The gateway strips `/api/chat`; `PresenceController` handles `GET /presence`.
It still accepts comma-separated or repeated `ids` parameters, ignores blanks
and duplicates, and requires 1–100 distinct IDs. The frontend's `getPresence`
helper remains available, but `usePresence` no longer calls it.
See the [chat API contract](../services/chat-service/API_CONTRACT.md) for errors
and the rest of the WebSocket protocol.

## Limits

Presence and subscriptions are stored in memory within one chat-service instance.
Multiple instances need shared presence state and event delivery. Events are best
effort and are not replayed; reconnect snapshots restore the current state.

The grace period starts when the backend detects a socket closure or transport
error. A silent network failure can take longer to detect; the existing
WebSocket idle timeout is 10 minutes. Socket tokens are validated at handshake
and existing connections are not closed simply because the token expires.

## Validation

Run the focused backend tests with Java 21 and access to Docker for the MongoDB
test container:

```sh
mvn -f services/chat-service/pom.xml \
  -Dtest=PresenceRegistryTest,PresenceControllerTest,WebSocketPresenceTest test
```

The backend tests cover snapshots, online/offline delivery over real sockets,
multiple tabs, grace-period cancellation, stale callbacks, cleanup, input errors,
and the retained authenticated REST endpoint.

Run frontend checks from the repository root:

```sh
npm --prefix frontend/app run test:presence
npm --prefix frontend/app run lint
npm --prefix frontend/app run build
```

The frontend tests exercise the shared socket with browser and HTTP boundaries
mocked: snapshots and changes, overlapping views, reconnect recovery, ignoring
old socket frames, batches of at most 100 IDs, and logout cleanup.
