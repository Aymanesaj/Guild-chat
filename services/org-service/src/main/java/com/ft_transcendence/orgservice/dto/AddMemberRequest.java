package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record AddMemberRequest(
        @NotNull(message = "Target user ID cannot be null")
        UUID UserId
) {}
