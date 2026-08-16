package com.fttranscendence.chatservice.message.dto;

/**
 * Machine-readable reasons a WebSocket frame was rejected.
 *
 * Codes exist so the client can branch on behaviour (retry? show a red banner?
 * disable the composer?) without string-matching an English sentence that a
 * later commit might reword.
 */
public enum WsErrorCode {

    /** Frame was not valid JSON, or did not map onto IncomingMessage. */
    INVALID_PAYLOAD,

    /** Parsed fine, but broke a constraint — blank content, over 2000 chars. */
    VALIDATION_FAILED,

    /** roomId does not exist. */
    ROOM_NOT_FOUND,

    /** Room exists, but the sender is not a member of it. */
    FORBIDDEN,

    /** Sender exceeded their token bucket. Client should back off. */
    RATE_LIMITED,

    /** Anything unexpected on our side. Never carries internal detail. */
    SERVER_ERROR
}
