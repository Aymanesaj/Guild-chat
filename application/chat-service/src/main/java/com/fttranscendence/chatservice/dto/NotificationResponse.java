package com.fttranscendence.chatservice.dto;

import java.time.Instant;

import com.fttranscendence.chatservice.model.Notification;

/**
 * A notification as the API shows it. Ids only: the client resolves the
 * actor's name and the room's name when it renders.
 */
public record NotificationResponse(
        String id,
        String type,
        String actorId,
        Long roomId,
        String role,
        String friendshipId,
        Instant createdAt,
        boolean read) {

    public static NotificationResponse from(Notification notification) {
        return new NotificationResponse(notification.id(), notification.type(), notification.actorId(),
                notification.roomId(), notification.role(), notification.friendshipId(),
                notification.createdAt(), notification.readAt() != null);
    }
}
