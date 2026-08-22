package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdateRoomRequest(
        @NotBlank(message = "Room name cannot be blank")
        String name
) {
}