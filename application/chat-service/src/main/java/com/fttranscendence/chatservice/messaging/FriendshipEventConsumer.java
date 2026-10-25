package com.fttranscendence.chatservice.messaging;

import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.service.NotificationService;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.WsEvents;

/**
 * Forwards identity's friendship events to the users' open sockets.
 *
 * Frames carry ids only: the frontend refetches friends and requests over
 * REST, so identity's own rules decide what is shown.
 */
@Component
public class FriendshipEventConsumer {

    private static final Logger logger = LoggerFactory.getLogger(FriendshipEventConsumer.class);
    private final ChatWebSocketHandler sockets;
    private final NotificationService notifications;

    public FriendshipEventConsumer(ChatWebSocketHandler sockets, NotificationService notifications) {
        this.sockets = sockets;
        this.notifications = notifications;
    }


    @RabbitListener(queues = RabbitMQConfig.CHAT_FRIENDSHIP_EVENTS_QUEUE)
    public void consume(FriendshipEvent event) {
        validate(event);
        String requester = event.requesterId();
        String addressee = event.addresseeId();

        switch (event.eventType()) {
            case FRIEND_REQUEST_SENT -> {
                sockets.sendToUser(addressee, WsEvents.FRIEND_REQUEST_RECEIVED, data(event , requester));
                sockets.sendToUser(requester, WsEvents.FRIEND_REQUEST_SENT, data(event , addressee));
                notifications.friendRequestSent(event.eventId(), event.friendshipId(), requester, addressee);
            }
            case FRIEND_REQUEST_ACCEPTED -> {
                sockets.sendToUser(addressee, WsEvents.FRIEND_REQUEST_ADDED, data(event , requester));
                sockets.sendToUser(requester, WsEvents.FRIEND_REQUEST_ADDED, data(event , addressee));
                notifications.friendRequestAccepted(event.eventId(), event.friendshipId(), requester, addressee);
            }
        }
         logger.info("Consumed friendship event={} id={} friendship={}",
                event.eventType(), event.eventId(), event.friendshipId());
    }


    /** data: { friendship_id, user_id } where user_id is the OTHER person. */
    private static Map<String , Object> data(FriendshipEvent event , String  otherUserId) {
        return Map.of("friendship_id" , event.friendshipId(), "user_id" , otherUserId);
    }

    /** Everything is checked before any frame is sent; a bad event goes to the DLQ untouched. */
    private static void validate(FriendshipEvent event) {
        if (event == null || event.eventType() == null) {
            throw new IllegalArgumentException("Invalid friendship event");
        }
        if (event.version() == null || event.version() != 1) {
            throw new IllegalArgumentException("Unsupported friendship event version: "
                    + (event.version()));
        }
        requireUuid(event.eventId(), "eventId");
        requireUuid(event.friendshipId(), "friendshipId");
        requireUuid(event.requesterId(), "requesterId");
        requireUuid(event.addresseeId(), "addresseeId");
        if (event.requesterId().equalsIgnoreCase(event.addresseeId())) {
            throw new IllegalArgumentException("A friendship needs two different users");
        }
    }

    // UUID.fromString throws IllegalArgumentException for malformed input too.
    private static void requireUuid(String value, String field) {
        if (value == null || !UUID.fromString(value).toString().equalsIgnoreCase(value)) {
            throw new IllegalArgumentException(field + " must be a UUID string");
        }
    }
}
