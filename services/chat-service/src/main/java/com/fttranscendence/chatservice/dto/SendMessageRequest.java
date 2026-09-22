package com.fttranscendence.chatservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of POST /rooms/:id/messages.
 *
 * Note what is NOT here: senderId and roomId. The sender comes from the
 * validated token and the room from the path, so neither can be spoofed by
 * the client. content_type is not accepted either — v1 is text only.
 */

public record SendMessageRequest(
    @NotBlank(message = "Message content cannot be blank")
    @Size (max = MAX_CONTENT_LENGTH, message= "content must be at most {max} characters")
    String content,
    String replyToId) {
        public static final int MAX_CONTENT_LENGTH = 4000;
}
