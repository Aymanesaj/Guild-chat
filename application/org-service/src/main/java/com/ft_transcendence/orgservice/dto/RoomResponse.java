package com.ft_transcendence.orgservice.dto;

import java.time.Instant;
import com.ft_transcendence.orgservice.model.RoomType;
import java.util.UUID;

public record RoomResponse(
        Long id,
        String name,
        String description,
        Instant createdAt,
        RoomType type,
        Instant updatedAt,
        UUID userIdIfDm
) {
}