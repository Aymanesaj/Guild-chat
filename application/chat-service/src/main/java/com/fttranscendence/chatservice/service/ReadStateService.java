package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.bson.types.ObjectId;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.repository.ReadStateStore;

/**
 * What each user has read: a mark per room, and unread counts from it.
 * Membership is checked on every call, like history.
 */
@Service
public class ReadStateService {

    static final int MAX_ROOMS = 100;

    /** The mark after a read, and what is still unread past it. */
    public record ReadMark(Long roomId, String lastReadId, int unread) {}

    private final ReadStateStore store;
    private final MessageRepository messageRepository;
    private final OrgClient orgClient;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public ReadStateService(ReadStateStore store, MessageRepository messageRepository, OrgClient orgClient,
            Clock clock, ApplicationEventPublisher events) {
        this.store = store;
        this.messageRepository = messageRepository;
        this.orgClient = orgClient;
        this.clock = clock;
        this.events = events;
    }

    /**
     * Marks the room read up to messageId, which must be a message of this
     * room. Only moves forward. The user's other sockets hear it as room.read.
     */
    public ReadMark markRead(String userId, Long roomId, String messageId) {
        if (!orgClient.isMember(userId, roomId)) {
            throw ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room");
        }
        if (!ObjectId.isValid(messageId)) {
            throw ApiException.badRequest("INVALID_MESSAGE_ID", "'message_id' is not a valid message id");
        }
        // Another room's message would move this room's mark past messages never seen.
        messageRepository.findById(messageId)
                .filter(message -> roomId.equals(message.getRoomId()))
                .orElseThrow(() -> ApiException.notFound("MESSAGE_NOT_FOUND", "Message does not exist in this room"));

        String mark = store.markRead(userId, roomId, messageId, clock.instant());
        ReadMark read = new ReadMark(roomId, mark, store.unreadCount(userId, roomId, mark));
        events.publishEvent(new RoomReadEvent(userId, read));
        return read;
    }

    /**
     * Unread count of each room the user is in, capped at
     * ReadStateStore.MAX_COUNTED. Rooms the user is not in are left out, not
     * an error, as for last-messages.
     */
    public Map<Long, Integer> unreadCounts(String userId, List<Long> roomIds) {
        List<Long> wanted = roomIds == null ? List.of() : roomIds.stream().distinct().toList();
        if (wanted.isEmpty()) {
            throw ApiException.badRequest("MISSING_IDS", "'ids' must list at least one room id");
        }
        if (wanted.size() > MAX_ROOMS) {
            throw ApiException.badRequest("TOO_MANY_IDS", "'ids' must list at most " + MAX_ROOMS + " room ids");
        }

        List<Long> allowed = wanted.stream()
                .filter(roomId -> orgClient.isMember(userId, roomId))
                .toList();
        Map<Long, String> marks = allowed.isEmpty() ? Map.of() : store.lastRead(userId, allowed);

        Map<Long, Integer> counts = new LinkedHashMap<>();
        allowed.forEach(roomId -> counts.put(roomId, store.unreadCount(userId, roomId, marks.get(roomId))));
        return counts;
    }
}
