package com.fttranscendence.chatservice.dto;

import java.util.List;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of POST /rooms/:id/messages.
 *
 * Note what is NOT here: senderId and roomId. The sender comes from the
 * validated token and the room from the path, so neither can be spoofed by
 * the client.
 *
 * content may be empty when images are attached; "no text and no image" is
 * rejected by the service (EMPTY_MESSAGE).
 */
public record SendMessageRequest(
    @Size(max = MAX_CONTENT_LENGTH, message = "content must be at most {max} characters")
    String content,
    String replyToId,
    @Size(max = MAX_ATTACHMENTS, message = "at most {max} images per message")
    List<@Pattern(regexp = UUID, message = "must be an upload_id") String> attachmentUploadIds) {

    public static final int MAX_CONTENT_LENGTH = 4000;
    public static final int MAX_ATTACHMENTS = 4;
    private static final String UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
}
