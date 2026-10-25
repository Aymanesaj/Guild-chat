package com.fttranscendence.chatservice.messaging;


import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.repository.ReadStateStore;
import com.fttranscendence.chatservice.service.AttachmentCleaner;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.WsEvents;


@Component

public class RoomChangedConsumer {

    private static final Logger logger  = LoggerFactory.getLogger(RoomChangedConsumer.class);



    private final ChatWebSocketHandler sockets;
    private final RoomMembersCache roomMembers;
    private final MessageRepository messageRepository;
    private final AttachmentCleaner attachmentCleaner;
    private final ReadStateStore readStates;


    public RoomChangedConsumer(
        ChatWebSocketHandler sockets,
        RoomMembersCache roomMembers,
        MessageRepository messageRepository,
        AttachmentCleaner attachmentCleaner,
        ReadStateStore readStates
    ) {
        this.sockets = sockets;
        this.roomMembers = roomMembers;
        this.messageRepository = messageRepository;
        this.attachmentCleaner = attachmentCleaner;
        this.readStates = readStates;
    }

    @RabbitListener(queues = RabbitMQConfig.CHAT_ROOM_EVENTS_QUEUE)
    public void consume(RoomChangedMessage message) {

        validate(message);
        Long roomId = Long.valueOf(message.roomId());
        String event = eventFor(message.change());

        // Permanent deletion is authorized only by an explicit committed room deletion.
        if (message.roomDeleted()) {
            // Read the images before the messages that hold their ids are gone.
            List<Attachment> images = messageRepository
                    .findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(roomId)
                    .stream()
                    .flatMap(stored -> stored.getAttachments().stream())
                    .toList();
            long deleted = messageRepository.deleteByRoomId(roomId);
            readStates.deleteByRoomId(roomId);
            attachmentCleaner.deleteAll(images);
            logger.info("Deleted messages for room={} count={} images={}", roomId, deleted, images.size());
        }

        // Force the next membership lookup to query org-service again.
        roomMembers.invalidate(roomId);
        if(message.roomDeleted()) {
            sockets.closeRoom(roomId);
        }else  if(message.change() == RoomChange.ROOM_REMOVED) {
            message.userIds().forEach(userId -> sockets.revokeRoom(userId, roomId));

        }
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

        if (!message.roomId().matches("[1-9][0-9]*") || Long.parseLong(message.roomId()) <= 0) {
            throw new IllegalArgumentException("roomId must be a positive decimal Long string");
        }
        // Validate ALL recipients before invalidating caches, deleting history or sending frames.
        for (String userId : message.userIds()) {
            if (userId == null || !UUID.fromString(userId).toString().equalsIgnoreCase(userId)) {
                throw new IllegalArgumentException("Recipients must be UUID strings");
            }
        }
        if (message.userIds().isEmpty() && !message.roomDeleted()) {
            throw new IllegalArgumentException("Only room deletion can have no recipients");
        }

        if(message.roomDeleted()
            && message.change() != RoomChange.ROOM_REMOVED) {
            throw new  IllegalArgumentException(
                "A deleted room must use ROOM_REMOVED"
            );
        }
    }

    private static String eventFor(RoomChange change) {
        return switch (change) {
            case ROOM_ADDED -> WsEvents.ROOM_ADDED;
            case ROOM_UPDATED -> WsEvents.ROOM_UPDATED;
            case ROOM_REMOVED -> WsEvents.ROOM_REMOVED;
        };
    }
}
