package com.fttranscendence.chatservice.messaging;


import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;


@Component

public class RoomChangedConsumer {

    private static final Logger logger  = LoggerFactory.getLogger(RoomChangedConsumer.class);



    private final ChatWebSocketHandler sockets;
    private final RoomMembersCache roomMembers;
    private final MessageRepository messageRepository;


    public RoomChangedConsumer(
        ChatWebSocketHandler sockets,
        RoomMembersCache roomMembers,
        MessageRepository messageRepository
    ) {
        this.sockets = sockets;
        this.roomMembers = roomMembers;
        this.messageRepository = messageRepository;
    }

    @RabbitListener(queues = RabbitMQConfig.CHAT_ROOM_EVENTS_QUEUE)
    public void consume(RoomChangedMessage message) {

        validate(message);
        Long roomId = message.roomId() == null ? null : Long.valueOf(message.roomId());
        String event = eventFor(message.change());


        ///Delete history only  when the entier room was deleted
        if (message.roomDeleted()) {
            if (roomId == null || roomId <= 0) {
                logger.warn("Attempted to delete messages for a null room");
                return;
            }
            Long deleted = messageRepository.deleteByRoomId(roomId.toString());

            logger.info(
                "Deleted messages for room={} count={}",
                roomId,
                deleted
            );
        }

        //Force the next memebership lookup to query org-service again.
        roomMembers.invalidate(roomId);

        Map<String , Object> data = Map.of("room_id" , roomId);
        List<String> userIds = message.userIds() == null
            ? List.of()
            : message.userIds();

        userIds.forEach(
            userId -> sockets.sendToUser(userId, event , data)
        );

        logger.info (
            "Consumed room event={} room={} users={}",
            event,
            roomId,
            userIds.size()
        );
    }

    private static void validate(RoomChangedMessage message) {
        if(message == null
            || message.roomId() == null
            || message.change() == null
            || message.userIds() == null) {
                throw new IllegalArgumentException(
                    "Invalid room-change event"
                );
        }

        if(eventFor(message.change()) == null) {
            throw new IllegalArgumentException(
                "Unknown room-change type: " + message.change()
            );
        }


        if(message.roomDeleted()
            && !"ROOM_REMOVED".equals(message.change())) {
            throw new  IllegalArgumentException(
                "A deleted room must use ROOM_REMOVED"
            );
        }
    }

    private static String eventFor(String change) {
        return switch (change) {
            case "ROOM_CREATED" -> "room.created";
            case "ROOM_UPDATED" -> "room.updated";
            case "ROOM_REMOVED" -> "room.removed";
            default -> null;
        };
    }
}
