package com.fttranscendence.chatservice.service;

import com.fttranscendence.chatservice.model.Notification;

/** Published once a notification is stored (not for a duplicate), to push it to the user's sockets. */
public record NotificationCreatedEvent(Notification notification) {
}
