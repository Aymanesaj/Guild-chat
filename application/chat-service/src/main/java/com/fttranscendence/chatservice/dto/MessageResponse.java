package com.fttranscendence.chatservice.dto;

import java.time.Instant;
import java.util.List;
import java.util.function.Function;

import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.model.Message;
/**
 * What the API returns. Separate from the Message document so that database
 * changes and API changes stay independent — and so deleted messages can hide
 * their content without touching what is stored.
 */
public record MessageResponse(
        String id,
        Long roomId,
        String senderId,
        String replyToId,
        String content,
        String contentType,
        Instant createdAt,
        Instant editedAt,
        boolean deleted,
        List<AttachmentResponse> attachments,
        SystemEventResponse system) {

    /** Images without URLs: previews (room.activity, last-messages). */
    public static MessageResponse from(Message message) {
        return from(message, AttachmentResponse::from);
    }

    /** Images built by the caller, e.g. with signed URLs (AttachmentUrls::sign). */
    public static MessageResponse from(Message message, Function<Attachment, AttachmentResponse> attachment) {
        boolean deleted = message.isDeleted();

        return new MessageResponse(
                message.getId(),
                message.getRoomId(),
                message.getSenderId(),
                message.getReplyToId(),
                deleted ? null : message.getContent(),
                message.getContentType(),
                message.getCreatedAt(),
                message.getEditedAt(),
                deleted,
                deleted ? List.of() : message.getAttachments().stream().map(attachment).toList(),
                SystemEventResponse.from(message.getSystem()));
    }
}
