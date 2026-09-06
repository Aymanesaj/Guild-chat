package com.ft_transcendence.orgservice.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateDirectMessageRequest(
    @NotNull
    UUID userId
) {}