package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import com.ft_transcendence.orgservice.model.RoomType;

public record CreateRoomRequest(
        @Size(max = 100)
        String name,
        @NotNull
        RoomType type
) {
}