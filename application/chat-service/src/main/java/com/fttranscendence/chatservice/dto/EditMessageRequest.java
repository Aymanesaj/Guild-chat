package com.fttranscendence.chatservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of PATCH /messages/:id. Only the content can change: room, sender and
 * reply target are fixed once the message exists.
*/

public record EditMessageRequest(
    @NotBlank(message = "content cannot be blank")
    @Size(max = SendMessageRequest.MAX_CONTENT_LENGTH, message = "content cannot exceed {max} characters")
    String content)
    {
}
