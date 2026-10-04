package com.fttranscendence.identity.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record SendFriendRequest(@NotNull UUID addresseeId) {
}
