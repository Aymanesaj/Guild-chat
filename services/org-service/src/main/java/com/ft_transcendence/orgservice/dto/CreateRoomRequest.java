package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateRoomRequest(
        @NotBlank(message = "Room name cannot be blank")
        @NotNull(message = "Room name cannot be null")
        @Size(max = 100)
        String name
) {
}