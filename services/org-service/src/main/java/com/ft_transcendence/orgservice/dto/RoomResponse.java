package com.ft_transcendence.orgservice.dto;

import java.time.Instant;
import com.ft_transcendence.orgservice.model.RoomType;

public record RoomResponse(
        Long id,
        String name,
        Instant createdAt,
        RoomType type,
        Instant updatedAt
) {
}