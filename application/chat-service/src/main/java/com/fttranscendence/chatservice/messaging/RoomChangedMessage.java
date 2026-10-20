package com.fttranscendence.chatservice.messaging;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Public AMQP schema, independent of Java packages and the internal protobuf enum. */
public record RoomChangedMessage(
        @JsonProperty("roomId") String roomId,
        @JsonProperty("change") String change,
        @JsonProperty("userIds") List<String> userIds,
        @JsonProperty("roomDeleted") boolean roomDeleted) {}
