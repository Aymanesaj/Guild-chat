package com.fttranscendence.chatservice.websocket;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.dto.NotificationResponse;
import com.fttranscendence.chatservice.dto.NotificationsReadResponse;
import com.fttranscendence.chatservice.service.NotificationCreatedEvent;
import com.fttranscendence.chatservice.service.NotificationsReadEvent;

/** Pushes notifications to every socket of their user: a new one, and reads from another tab. */
@Component
public class NotificationNotifier {

    private final ChatWebSocketHandler sockets;

    public NotificationNotifier(ChatWebSocketHandler sockets) {
        this.sockets = sockets;
    }

    @EventListener
    public void onCreated(NotificationCreatedEvent event) {
        sockets.sendToUser(event.notification().userId(), WsEvents.NOTIFICATION_NEW,
                NotificationResponse.from(event.notification()));
    }

    @EventListener
    public void onRead(NotificationsReadEvent event) {
        sockets.sendToUser(event.userId(), WsEvents.NOTIFICATION_READ, NotificationsReadResponse.from(event.read()));
    }
}
