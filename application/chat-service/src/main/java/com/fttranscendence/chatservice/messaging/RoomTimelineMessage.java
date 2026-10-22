package com.fttranscendence.chatservice.messaging;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Org's room timeline event, version 1. camelCase JSON, independent of HTTP naming. */
public record RoomTimelineMessage(
        @JsonProperty("eventId") String eventId,
        @JsonProperty("version") Integer version,
        @JsonProperty("type") RoomTimelineType type,
        @JsonProperty("roomId") String roomId,
        @JsonProperty("actorId") String actorId,
        @JsonProperty("targetId") String targetId,
        @JsonProperty("role") String role,
        @JsonProperty("previousRole") String previousRole,
        @JsonProperty("name") String name,
        @JsonProperty("previousName") String previousName,
        @JsonProperty("occurredAt") String occurredAt) {
}
