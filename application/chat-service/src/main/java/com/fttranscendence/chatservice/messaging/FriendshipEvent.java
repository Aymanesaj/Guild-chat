package com.fttranscendence.chatservice.messaging;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Identity's friendship event, version 1. camelCase JSON, independent of HTTP naming. */
public record FriendshipEvent(
        @JsonProperty("eventId") String eventId,
        @JsonProperty("eventType") FriendshipEventType eventType,
        @JsonProperty("version") Integer version,
        @JsonProperty("friendshipId") String friendshipId,
        @JsonProperty("requesterId") String requesterId,
        @JsonProperty("addresseeId") String addresseeId,
        @JsonProperty("occurredAt") String occurredAt) {
}
