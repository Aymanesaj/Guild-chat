# DM hiding and reopening

## Hide

Call `DELETE /api/orgs/rooms/dm/{roomId}` as the authenticated user. On `204 No Content`, remove the DM from local conversation state or refetch the DM list. Repeated calls are idempotent. The existing `room.removed` event may also reconcile other tabs/devices. Only the caller's visibility changes; the peer, memberships, roles, room, and message history remain intact.

## Reopen

Use the existing get-or-create endpoint when the user intentionally opens/reopens a persisted conversation:

```http
POST /api/orgs/rooms/dm
Content-Type: application/json

{"userId": "<peer UUID>"}
```

This returns the existing DM and clears the caller's hidden state, or creates the DM if it has never existed. It never creates another DM for the same normalized user pair. A visibility change emits existing `room.added` only for the caller; reopening an already visible DM emits no extra event. The peer's hidden state is unchanged.

The current `openDm(peer)` in `src/api/rooms.js` is read-only: if the DM is absent from `GET /rooms/dm`, it returns a local `draft-dm:*`. Hidden DMs are deliberately absent from that list. The frontend developer must decide which explicit “open/reopen conversation” user action calls `POST /rooms/dm` when persistence/reopening is desired. Do not add a backend endpoint solely to distinguish hidden from never-created DMs. Use the returned persisted room ID to open the conversation and fetch its existing history.

## Incoming messages

After a normal message is stored, chat asks org to clear hidden state for both participants. Org emits existing `ROOM_ADDED` only for participants whose visibility changed; chat forwards `room.added`. On that event, refetch/sync the DM list. Existing history remains available in the same room. `room.activity` continues to update message preview/order as before.

Visibility synchronization is best-effort: if org is unavailable after message storage, the message and its normal events remain successful, but a hidden conversation may stay hidden until explicit reopening or a later successful message reveal. There is no automatic retry in this change.

Hiding is a conversation-list preference, not an access revocation: membership and history access remain intact.

## Frontend files likely involved

- `gateway-frontend/frontend/src/api/rooms.js`
- `gateway-frontend/frontend/src/components/dms/DmView.jsx`
- `gateway-frontend/frontend/src/components/layout/MainPanel.jsx`
- `gateway-frontend/frontend/src/api/messages.js`

No frontend implementation is changed by this backend feature.
