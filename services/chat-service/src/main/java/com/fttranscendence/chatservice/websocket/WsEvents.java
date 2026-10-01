package com.fttranscendence.chatservice.websocket;
/**
 * Event names from spec §4.5. Frozen for v1: additive changes are fine,
 * renames are not. Constants rather than string literals, so a typo is a
 * compile error instead of a frame nobody handles.
 *
 * Not implemented on purpose:
 *   - "typing"   — dropped for v1 by decision of the chat-service owner
 *   - "presence" — clients poll GET /presence instead (PresenceRegistry)
*/
public final class WsEvents {

    // client → server
    public static final String SUBSCRIBE = "subscribe";
    public static final String UNSUBSCRIBE = "unsubscribe";

    // server → client
    public static final String MESSAGE_NEW = "message.new";
    public static final String MESSAGE_EDITED = "message.edited";
    public static final String MESSAGE_DELETED = "message.deleted";

    // server → client, sent to a USER (all their sockets) rather than to a
    // room's subscribers: the point is to reach people who have no room open.

    /** You can now see this room (created, added to it, new DM). data: { room_id } */
    public static final String ROOM_ADDED = "room.added";
    /** You can no longer see this room (left, kicked, deleted). data: { room_id } */
    public static final String ROOM_REMOVED = "room.removed";
    /** A room you are in changed: name, members or roles. data: { room_id } */
    public static final String ROOM_UPDATED = "room.updated";
    /**
     * A message was sent, edited or deleted in one of your rooms, whether or
     * not you are subscribed to it. Feeds list previews and ordering.
     * data: { room_id, change: "new" | "edited" | "deleted", message }
     */
    public static final String ROOM_ACTIVITY = "room.activity";

    /** Not in the spec: there is no status code after the upgrade, so errors are frames. */
    public static final String ERROR = "error";

    private WsEvents() {
    }
}
