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

    /** Not in the spec: there is no status code after the upgrade, so errors are frames. */
    public static final String ERROR = "error";

    private WsEvents() {
    }
}
