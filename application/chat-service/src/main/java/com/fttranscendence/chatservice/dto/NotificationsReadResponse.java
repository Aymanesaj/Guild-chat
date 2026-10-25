package com.fttranscendence.chatservice.dto;

import java.util.List;

import com.fttranscendence.chatservice.service.NotificationService;

/** After marking read, over REST and in notification.read frames. ids is null when all were marked. */
public record NotificationsReadResponse(List<String> ids, boolean all, int unread) {

    public static NotificationsReadResponse from(NotificationService.ReadResult read) {
        return new NotificationsReadResponse(read.ids(), read.all(), read.unread());
    }
}
