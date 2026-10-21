package com.ft_transcendence.orgservice.messaging;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.service.RoomTimelineEvent;

/** Public JSON contract, independent of Java type headers and HTTP mapper settings. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RoomTimelineMessage(
        @JsonProperty("eventId") String eventId,
        @JsonProperty("version") int version,
        @JsonProperty("type") RoomTimelineType type,
        @JsonProperty("roomId") String roomId,
        @JsonProperty("actorId") String actorId,
        @JsonProperty("targetId") String targetId,
        @JsonProperty("role") RoleName role,
        @JsonProperty("previousRole") RoleName previousRole,
        @JsonProperty("name") String name,
        @JsonProperty("previousName") String previousName,
        @JsonProperty("occurredAt") String occurredAt) {
    public static RoomTimelineMessage from(RoomTimelineEvent event) {
        return new RoomTimelineMessage(event.eventId().toString(), event.version(), event.type(),
                event.roomId().toString(), event.actorId().toString(),
                event.targetId() == null ? null : event.targetId().toString(),
                event.role(), event.previousRole(), event.name(), event.previousName(),
                event.occurredAt().toString());
    }
}
