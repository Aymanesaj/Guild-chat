package com.fttranscendence.chatservice.websocket;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fttranscendence.chatservice.dto.NotificationResponse;
import com.fttranscendence.chatservice.dto.NotificationsReadResponse;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.service.NotificationCreatedEvent;
import com.fttranscendence.chatservice.service.NotificationService;
import com.fttranscendence.chatservice.service.NotificationsReadEvent;

class NotificationNotifierTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";

    private final ChatWebSocketHandler sockets = mock(ChatWebSocketHandler.class);
    private final NotificationNotifier notifier = new NotificationNotifier(sockets);

    @Test
    @DisplayName("a new notification goes to its user's sockets as notification.new")
    void pushesNew() {
        Notification notification = new Notification("66f0c1a2b3c4d5e6f7a8b9c0", ALICE, Notification.FRIEND_REQUEST,
                BOB, null, null, "f1", "source", Instant.parse("2026-10-25T10:00:00Z"), null);

        notifier.onCreated(new NotificationCreatedEvent(notification));

        verify(sockets).sendToUser(ALICE, "notification.new", NotificationResponse.from(notification));
    }

    @Test
    @DisplayName("a read goes to the reader's sockets as notification.read")
    void pushesRead() {
        NotificationService.ReadResult read = new NotificationService.ReadResult(List.of("a"), false, 1);

        notifier.onRead(new NotificationsReadEvent(ALICE, read));

        verify(sockets).sendToUser(ALICE, "notification.read", new NotificationsReadResponse(List.of("a"), false, 1));
    }
}
