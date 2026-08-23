package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateRoomRequest(
        @NotBlank(message = "Room name cannot be blank")
        @Size(max = 100, message = "Room name cannot exceed 100 characters")
        String name
) {
}