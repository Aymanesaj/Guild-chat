package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import com.ft_transcendence.orgservice.model.RoomType;
import java.util.UUID;

public record CreateRoomRequest(
        @Size(max = 100)
        String name,
        @NotNull
        RoomType type,
        // TEMPORARY: creatorId will come from the authenticated user
        // once authentication/Identity Service integration is implemented.
        @NotNull
        UUID creatorId
) {
}