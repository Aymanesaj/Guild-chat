package com.fttranscendence.chatservice.dto;

import java.time.Instant;

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
        boolean deleted) {

    public static MessageResponse from(Message message) {
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
                deleted);
    }
}
