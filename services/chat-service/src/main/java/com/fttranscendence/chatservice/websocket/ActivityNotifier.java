package com.fttranscendence.chatservice.websocket;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageCreatedEvent;
import com.fttranscendence.chatservice.service.MessageDeletedEvent;
import com.fttranscendence.chatservice.service.MessageEditedEvent;

import jakarta.annotation.PreDestroy;

/**
 * Tells every member of a room that something happened in it: room.activity.
 *
 * RoomBroadcaster only reaches sockets subscribed to the room, i.e. people
 * with that room open. Someone looking at their DM list is subscribed to
 * nothing, yet the list must move the conversation to the top and show the
 * new preview. This is what reaches them.
 *
 * Off the request thread, unlike RoomBroadcaster: the member list may need a
 * gRPC call to org (up to the deadline), and the POST must not wait for a
 * preview. So a room.activity can arrive slightly before or after the
 * matching message.new; the client treats them independently.
 *
 * Best effort: if org cannot list the members, the activity is dropped and
 * logged. The message itself is already stored and broadcast to the room.
 */
@Component
public class ActivityNotifier {

    private static final Logger log = LoggerFactory.getLogger(ActivityNotifier.class);

    static final String NEW = "new";
    static final String EDITED = "edited";
    static final String DELETED = "deleted";

    private final RoomMembersCache roomMembers;
    private final ChatWebSocketHandler sockets;
    private final Executor executor;
    /** The executor this class created and must shut down; null when a test supplied one. */
    private final ExecutorService ownedExecutor;

    @Autowired
    public ActivityNotifier(RoomMembersCache roomMembers, ChatWebSocketHandler sockets) {
        // Virtual threads: each task mostly waits on a gRPC call, and there is
        // no reason to cap how many previews can be in flight.
        this(roomMembers, sockets, Executors.newVirtualThreadPerTaskExecutor());
    }

    /** For tests: pass Runnable::run to make delivery synchronous. */
    ActivityNotifier(RoomMembersCache roomMembers, ChatWebSocketHandler sockets, Executor executor) {
        this.roomMembers = roomMembers;
        this.sockets = sockets;
        this.executor = executor;
        this.ownedExecutor = executor instanceof ExecutorService service ? service : null;
    }

    @EventListener
    public void onCreated(MessageCreatedEvent event) {
        notifyMembers(event.message(), NEW);
    }

    @EventListener
    public void onEdited(MessageEditedEvent event) {
        notifyMembers(event.message(), EDITED);
    }

    @EventListener
    public void onDeleted(MessageDeletedEvent event) {
        notifyMembers(event.message(), DELETED);
    }

    /**
     * Queues one room.activity per member of the message's room, sent to all
     * of that member's sockets. The sender is included: their other tabs and
     * devices need the preview too.
     *
     * The sender is the one asking org for the member list, because the
     * message was only accepted after org confirmed they are a member. For an
     * edit the sender is still the author; for a delete it may be a moderator,
     * but the author is still a member in the common case, and if not the
     * lookup fails and the activity is dropped.
     */
    private void notifyMembers(Message message, String change) {
        Long roomId = message.getRoomId();
        Map<String, Object> data = Map.of(
                "room_id", roomId,
                "change", change,
                "message", MessageResponse.from(message));

        executor.execute(() -> {
            List<String> members;
            try {
                members = roomMembers.members(roomId, message.getSenderId());
            } catch (ApiException e) {
                log.warn("room.activity dropped for room={}: {}", roomId, e.getCode());
                return;
            }
            members.forEach(userId -> sockets.sendToUser(userId, WsEvents.ROOM_ACTIVITY, data));
        });
    }

    @PreDestroy
    void shutdown() {
        if (ownedExecutor != null) {
            ownedExecutor.shutdown();
        }
    }
}
