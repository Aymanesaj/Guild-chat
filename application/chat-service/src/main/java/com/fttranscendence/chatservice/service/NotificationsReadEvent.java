package com.fttranscendence.chatservice.service;

/** Published after notifications are marked read, so the user's other tabs update. */
public record NotificationsReadEvent(String userId, NotificationService.ReadResult read) {
}
