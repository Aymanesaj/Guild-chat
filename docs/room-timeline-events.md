# Org → Chat room timeline events

**Status:** implemented on both sides. Org publishes from `RoomService`
(`RoomTimelinePublisher`); Chat consumes in `RoomTimelineConsumer` and stores
system messages. What the frontend receives is documented in
`application/chat-service/API_CONTRACT.md` under "System messages".

## Why

Rooms will show what happened in them, in the message history:

> Alice added Bob · Bob left · Carol is now an admin · Alice renamed the room to "Ops"

Chat stores these as **system messages** in its `messages` collection, so they
come back with `GET /rooms/{id}/messages` in the right place between ordinary
messages, and reach open rooms live as `message.new`.

The existing `room.changed` event ([room-events.md](room-events.md)) cannot
produce them. It describes each user's **room list** (`ROOM_REMOVED` to the
person leaving, `ROOM_UPDATED` to everyone else), so a kick and a leave look the
same. It also does not say who acted or what changed, and a single action
produces several of them.

So Org publishes **one additional event per action**: the room timeline event.
`room.changed` stays exactly as it is. It still drives room-list refreshes, and
**both are published** for the same action.

## Wire contract

- Exchange: `guildchat.room-events` (the existing durable direct exchange)
- Routing key: **`room.timeline`**
- Queue (owned by Chat, declared by **both** services): **`guildchat.chat-service.room-timeline`**, durable
- Content type: `application/json`, persistent delivery, no `__TypeId__` header
- JSON field names: **camelCase**, exactly as below (not the HTTP snake_case)

```json
{
  "eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "version": 1,
  "type": "MEMBER_KICKED",
  "roomId": "42",
  "actorId": "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
  "targetId": "b7c1d2e3-0000-4000-8000-000000000002",
  "role": null,
  "previousRole": null,
  "name": null,
  "previousName": null,
  "occurredAt": "2026-10-21T10:00:00.123Z"
}
```

| Field | Type | Rules |
|---|---|---|
| `eventId` | UUID string | **New random UUID per event.** Chat uses it to drop duplicates, so never reuse one |
| `version` | integer | Always `1` for this contract |
| `type` | string | One of the types below, exact uppercase name |
| `roomId` | string | Positive decimal room id, as in `room.changed` |
| `actorId` | UUID string | Who did it. Always present |
| `targetId` | UUID string or `null` | Who it was done to. Rules per type below |
| `role` / `previousRole` | `"OWNER"`, `"ADMIN"`, `"MEMBER"` or `null` | Only for `ROLE_CHANGED` and `OWNERSHIP_TRANSFERRED` |
| `name` / `previousName` | string or `null` | Only for `ROOM_CREATED` and `ROOM_RENAMED` |
| `occurredAt` | ISO-8601 UTC string | When the change happened in Org (`Instant.now()` at the change, not at publish) |

Every field is always present in the JSON. Unused fields are `null`, not
omitted.

## Event types and where Org publishes them

All in `RoomService`. **Group rooms only:** never publish a timeline event for a
`RoomType.DM` room. Never publish one for an operation that throws or rolls back.

| `type` | Method | `actorId` | `targetId` | Extra fields |
|---|---|---|---|---|
| `ROOM_CREATED` | `createRoom` | creator | `null` | `name` = room name |
| `MEMBER_JOINED` | `addMember` | who added | who was added | none |
| `MEMBER_LEFT` | `leaveRoom`, and `removeMember` when actor == target | the person leaving | same person as `actorId` | none |
| `MEMBER_KICKED` | `removeMember` when actor ≠ target | who removed | who was removed | none |
| `OWNERSHIP_TRANSFERRED` | `leaveRoom`, when the owner leaves and a successor is promoted | the departing owner | the successor | `role = "OWNER"`, `previousRole` = successor's role before (`"ADMIN"` or `"MEMBER"`) |
| `ROLE_CHANGED` | `updateMemberRole` | who changed it | whose role changed | `role` = new role, `previousRole` = old role |
| `ROOM_RENAMED` | `updateRoom` | who renamed | `null` | `name` = new name, `previousName` = old name (may be `null`) |

### Special cases

- **Owner leaves with other members:** publish `MEMBER_LEFT` **first**, then
  `OWNERSHIP_TRANSFERRED`, in that order. Chat shows "Alice left · Bob is now the
  owner".
- **Last member leaves (room deleted):** publish **no** timeline event. The room
  and its history are deleted; `room.changed` with `roomDeleted: true` already
  covers it.
- **`removeMember` currently calls `leaveRoom(roomId, targetUserId)`** and the
  actor is lost on the way. Refactor so the actor reaches the publishing code, for
  example a private `depart(roomId, targetId, actorId)` used by both, keeping the
  public signatures. Then actor == target → `MEMBER_LEFT`, otherwise
  `MEMBER_KICKED`.
- **`markRoomAsRead`, `createDirectMessageRoom`, lookups:** no timeline event.

## How Org should implement it

Follow the existing `room.changed` pattern so the reliability behaviour stays
identical:

1. **Internal event** `service/RoomTimelineEvent` (a record with the fields above,
   typed: `Long roomId`, `UUID actorId`, `RoleName role`, `Instant occurredAt`, …).
   Publish it with `ApplicationEventPublisher` **inside** the transaction, at the
   points in the table. Generate `eventId` and `occurredAt` there.
2. **Wire record** `messaging/RoomTimelineMessage` with explicit
   `@JsonProperty` names, all strings or ints as in the JSON example, and a
   `messaging/RoomTimelineType` enum. Do not reuse the internal record on the
   wire.
3. **Publisher:** a `@TransactionalEventListener(phase = AFTER_COMMIT)` method,
   in `RoomEventPublisher` or a sibling class. Same as today: persistent, remove
   `__TypeId__`, correlated confirm checked **asynchronously** with the existing
   timeout, failures logged with the "already committed … may be lost (no outbox)"
   message, and **never** fail the HTTP request.
4. **Topology** in `config/RabbitMQConfig`: declare the queue
   `guildchat.chat-service.room-timeline` and bind it to `guildchat.room-events`
   with `room.timeline`, next to the existing declarations. Publishing is
   `mandatory`, so without this binding every event is returned as unroutable.

### Org tests (definition of done)

- `RoomServiceEventsTest`: for each row in the table, the exact
  `RoomTimelineEvent` (type, actor, target, roles, names) is published.
- No timeline event for: a DM, a rolled-back or failed operation, and the
  last-member deletion.
- Owner departure publishes `MEMBER_LEFT` then `OWNERSHIP_TRANSFERRED`, in that
  order.
- `removeMember` by an admin → `MEMBER_KICKED`; by the user themselves →
  `MEMBER_LEFT`.
- `RoomEventPublisherTest`: the JSON has exactly the 11 field names above, nulls
  present, `roomId` a string, persistent, no `__TypeId__`, routing key
  `room.timeline`.
- The existing `room.changed` tests still pass unchanged.

## What Chat does with it

For Org's information. Chat owns this part.

- Consumes `guildchat.chat-service.room-timeline` and validates every field
  (UUIDs, type, the field rules per type). Invalid events go to the dead-letter
  queue after the usual 3 attempts.
- Inserts a system message: `content_type: "system"`, `sender_id: null`,
  `content: null`, plus a `system` object with the type, ids, roles and names, and
  the `event_id`. A unique index on `event_id` makes redelivery harmless: a
  duplicate insert is treated as already done.
- Fires its normal message-created path: `message.new` to sockets with the room
  open, and `room.activity` to every member.
- Stores **ids, not text**. The frontend renders the sentence and resolves
  usernames at display time, because names can change.
- System messages cannot be edited, deleted or replied to.

## Guarantees and limits

Same as `room.changed`: at least once, with no outbox.

- A crash or publish failure after commit can lose an event. The room is still
  correct; only the timeline line is missing.
- A redelivered event is ignored by Chat thanks to `eventId`. **Org must never
  reuse an `eventId`.**
- Order is preserved for one room, because it is a single queue with a single
  consumer. The message's position in history is when Chat stored it;
  `occurredAt` is available for display.

## Versioning

- Adding a new `type` or a new optional field is **additive**. Tell Chat before
  publishing it: until Chat knows a type, its events fail conversion and land in
  the dead-letter queue.
- Renaming or removing a field, or changing its meaning, needs `version: 2`.
