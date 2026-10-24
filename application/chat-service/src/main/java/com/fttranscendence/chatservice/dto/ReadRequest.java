package com.fttranscendence.chatservice.dto;

import jakarta.validation.constraints.NotBlank;

/** Body of PUT /rooms/:id/read: the newest message the user has seen in that room. */
public record ReadRequest(
    @NotBlank(message = "message_id is required")
    String messageId) {
}
