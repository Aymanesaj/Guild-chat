package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.util.List;

import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.repository.NotificationStore;
import com.fttranscendence.chatservice.repository.ReadStateStore;

/**
 * Notifications: friend requests and what happens to the user in rooms.
 *
 * Recorded from events chat already receives: identity's friendship events,
 * and org's room events once they are stored as system messages (so each
 * room event notifies once, whatever the broker redelivers). Only the person
 * affected is notified, and never for something they did themselves.
 *
 * Best effort: a notification that cannot be stored is logged and dropped,
 * so it never makes the event that caused it fail or be redelivered.
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 50;
    static final int MAX_IDS = 100;

    /** After a read: which ones (null when all) and what is left unread. */
    public record ReadResult(List<String> ids, boolean all, int unread) {}

    private final NotificationStore store;
    private final ReadStateStore readStates;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public NotificationService(NotificationStore store, ReadStateStore readStates, Clock clock,
            ApplicationEventPublisher events) {
        this.store = store;
        this.readStates = readStates;
        this.clock = clock;
        this.events = events;
    }

    /** Someone sent a friend request: tell the addressee. */
    public void friendRequestSent(String eventId, String friendshipId, String requesterId, String addresseeId) {
        record(Notification.of(addresseeId, Notification.FRIEND_REQUEST, requesterId, null, null,
                friendshipId, eventId, clock.instant()));
    }

    /** A friend request was accepted: tell the requester, who is waiting for the answer. */
    public void friendRequestAccepted(String eventId, String friendshipId, String requesterId, String addresseeId) {
        record(Notification.of(requesterId, Notification.FRIEND_ACCEPTED, addresseeId, null, null,
                friendshipId, eventId, clock.instant()));
    }

    /**
     * Room events become notifications for their target. Only newly stored
     * system messages get here: MessageService publishes nothing for a
     * redelivered event.
     */
    @EventListener
    public void onMessageCreated(MessageCreatedEvent event) {
        Message message = event.message();
        SystemEvent system = message.getSystem();
        if (!message.isSystem() || system == null || system.targetId() == null
                || system.targetId().equals(system.actorId())) {
            return;
        }
        String type;
        String role = null;
        switch (system.type()) {
            case "MEMBER_JOINED" -> type = Notification.ROOM_ADDED;
            case "MEMBER_KICKED" -> type = Notification.ROOM_REMOVED;
            case "ROLE_CHANGED" -> {
                type = Notification.ROLE_CHANGED;
                role = system.role();
            }
            case "OWNERSHIP_TRANSFERRED" -> {
                type = Notification.ROLE_CHANGED;
                role = "OWNER";
            }
            default -> {
                return; // left, created, renamed: nothing happened *to* someone else
            }
        }
        record(Notification.of(system.targetId(), type, system.actorId(), message.getRoomId(), role,
                null, message.getId(), message.getCreatedAt()));
    }

    /** Newest first. `before` is the id of the oldest notification already loaded. */
    public List<Notification> list(String userId, String before, Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : limit;
        if (size < 1 || size > MAX_LIMIT) {
            throw ApiException.badRequest("INVALID_LIMIT", "'limit' must be between 1 and " + MAX_LIMIT);
        }
        if (before != null && !ObjectId.isValid(before)) {
            throw ApiException.badRequest("INVALID_CURSOR", "'before' is not a valid notification id");
        }
        return store.page(userId, before, size);
    }

    public int unreadCount(String userId) {
        return store.unreadCount(userId);
    }

    @EventListener
    public void onRoomRead(RoomReadEvent event) {
        markRoomRead(event.userId(), event.read().roomId(), event.read().lastReadId());
    }

    private void markRoomRead(String userId, Long roomId, String lastReadId) {
        if (lastReadId == null) return;
        List<String> ids = store.markRoomRead(userId, roomId, lastReadId, clock.instant());
        if (!ids.isEmpty()) announce(userId, new ReadResult(ids, false, store.unreadCount(userId)));
    }

    /** Marks these read. Ids that are not the user's, or already read, are ignored. */
    public ReadResult markRead(String userId, List<String> ids) {
        List<String> wanted = ids == null ? List.of() : ids.stream().distinct().toList();
        if (wanted.isEmpty()) {
            throw ApiException.badRequest("MISSING_IDS", "'ids' must list at least one notification id");
        }
        if (wanted.size() > MAX_IDS) {
            throw ApiException.badRequest("TOO_MANY_IDS", "'ids' must list at most " + MAX_IDS + " ids");
        }
        if (!wanted.stream().allMatch(ObjectId::isValid)) {
            throw ApiException.badRequest("INVALID_NOTIFICATION_ID", "'ids' must be notification ids");
        }
        store.markRead(userId, wanted, clock.instant());
        return announce(userId, new ReadResult(wanted, false, store.unreadCount(userId)));
    }

    public ReadResult markAllRead(String userId) {
        store.markAllRead(userId, clock.instant());
        return announce(userId, new ReadResult(null, true, store.unreadCount(userId)));
    }

    /** Opening the profile's Friends section acknowledges incoming requests on every page. */
    public ReadResult markFriendRequestsRead(String userId) {
        List<String> ids = store.markFriendRequestsRead(userId, clock.instant());
        return announce(userId, new ReadResult(ids, false, store.unreadCount(userId)));
    }

    private ReadResult announce(String userId, ReadResult read) {
        events.publishEvent(new NotificationsReadEvent(userId, read));
        return read;
    }

    private void record(Notification notification) {
        try {
            store.insert(notification).ifPresent(saved -> {
                events.publishEvent(new NotificationCreatedEvent(saved));
                // A room read can race notification insertion. Recheck AFTER insert
                // so either this check or the room-read listener sees the new row.
                if (saved.roomId() != null) {
                    String mark = readStates.lastRead(saved.userId(), List.of(saved.roomId())).get(saved.roomId());
                    markRoomRead(saved.userId(), saved.roomId(), mark);
                }
            });
        } catch (DataAccessException e) {
            log.warn("notification {} for user={} not stored: {}",
                    notification.type(), notification.userId(), e.getMessage());
        }
    }
}
