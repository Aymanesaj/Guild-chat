package com.fttranscendence.chatservice.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.MarkNotificationsReadRequest;
import com.fttranscendence.chatservice.dto.NotificationResponse;
import com.fttranscendence.chatservice.dto.NotificationsReadResponse;
import com.fttranscendence.chatservice.service.NotificationService;

/**
 * The caller's notifications. Reachable through the gateway at
 * /api/chat/notifications/...; always the token's user, never someone else's.
 */
@RestController
@RequestMapping("/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public List<NotificationResponse> list(
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @RequestParam(required = false) String before,
            @RequestParam(required = false) Integer limit) {
        return notificationService.list(userId, before, limit).stream()
                .map(NotificationResponse::from)
                .toList();
    }

    @GetMapping("/unread-count")
    public Map<String, Integer> unreadCount(@RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId) {
        return Map.of("unread", notificationService.unreadCount(userId));
    }

    @PutMapping("/read")
    public NotificationsReadResponse markRead(
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @RequestBody MarkNotificationsReadRequest request) {
        return NotificationsReadResponse.from(notificationService.markRead(userId, request.ids()));
    }

    @PutMapping("/read-friend-requests")
    public NotificationsReadResponse markFriendRequestsRead(
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId) {
        return NotificationsReadResponse.from(notificationService.markFriendRequestsRead(userId));
    }

    @PutMapping("/read-all")
    public NotificationsReadResponse markAllRead(@RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId) {
        return NotificationsReadResponse.from(notificationService.markAllRead(userId));
    }
}
