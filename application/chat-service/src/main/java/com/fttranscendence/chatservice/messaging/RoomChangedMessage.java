package com.fttranscendence.chatservice.messaging;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Public AMQP schema, shared as JSON, not Java package names. */
public record RoomChangedMessage(
        @JsonProperty("roomId") String roomId,
        @JsonProperty("change") RoomChange change,
        @JsonProperty("userIds") List<String> userIds,
        @JsonProperty("roomDeleted") boolean roomDeleted) {}
