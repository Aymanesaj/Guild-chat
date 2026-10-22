package com.ft_transcendence.orgservice.service;

import java.time.Instant;
import java.util.UUID;
import com.ft_transcendence.orgservice.messaging.RoomTimelineType;
import com.ft_transcendence.orgservice.model.RoleName;

/** Immutable snapshot captured inside the business transaction. */
public record RoomTimelineEvent(UUID eventId, int version, RoomTimelineType type,
        Long roomId, UUID actorId, UUID targetId, RoleName role, RoleName previousRole,
        String name, String previousName, Instant occurredAt) {}
