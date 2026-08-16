package com.fttranscendence.chatservice.message.dto;

import lombok.Getter;

/**
 * Server -> client frame reporting that an inbound frame was rejected.
 *
 * Sent only to the client that caused it, never broadcast to the room.
 * The {@code type} field is the discriminator: every server frame carries one,
 * so the client can switch on it before parsing the rest.
 */
@Getter
public class ErrorFrame {

    /** Constant discriminator. Chat frames carry type "MESSAGE". */
    private final String type = "ERROR";

    private final WsErrorCode code;

    /** Human-readable, safe to show a developer. Never contains a stack trace. */
    private final String message;

    public ErrorFrame(WsErrorCode code, String message) {
        this.code = code;
        this.message = message;
    }
}
