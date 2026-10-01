package com.fttranscendence.chatservice.grpc;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fttranscendence.chat.grpc.ChatNotifyServiceGrpc;
import com.fttranscendence.chat.grpc.RoomChange;
import com.fttranscendence.chat.grpc.RoomChangedRequest;
import com.fttranscendence.chat.grpc.RoomChangedResponse;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.WsEvents;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;

/**
 * Receives org-service's "this room changed" notifications and pushes them to
 * the affected users' sockets as room.added / room.removed / room.updated.
 *
 * The frame carries only the room id. The client refetches its room list over
 * REST, which applies org's own permission rules, so this endpoint never has
 * to decide what a user may see.
 *
 * No authentication: like org's own gRPC server, it is reachable only on the
 * private Docker network and never published through the gateway.
 */
@Component
public class ChatNotifyGrpcService extends ChatNotifyServiceGrpc.ChatNotifyServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(ChatNotifyGrpcService.class);

    private final ChatWebSocketHandler sockets;
    private final RoomMembersCache roomMembers;

    public ChatNotifyGrpcService(ChatWebSocketHandler sockets, RoomMembersCache roomMembers) {
        this.sockets = sockets;
        this.roomMembers = roomMembers;
    }

    /**
     * Sends one frame to every socket of every listed user, then answers.
     * Replies before anything else could fail, and never waits on a slow
     * client: FrameSender only queues the write.
     *
     * Also drops the room's cached member list (RoomMembersCache), whatever
     * the change: any of them can change who receives room.activity.
     *
     * Errors: INVALID_ARGUMENT for a non-numeric room_id or an unset change.
     */
    @Override
    public void roomChanged(RoomChangedRequest request, StreamObserver<RoomChangedResponse> responseObserver) {
        Long roomId = parseRoomId(request.getRoomId());
        String event = eventFor(request.getChange());

        if (roomId == null || event == null) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("room_id must be a number and change must be set")
                    .asRuntimeException());
            return;
        }

        roomMembers.invalidate(roomId);

        Map<String, Object> data = Map.of("room_id", roomId);
        request.getUserIdsList().forEach(userId -> sockets.sendToUser(userId, event, data));
        log.debug("{} room={} users={}", event, roomId, request.getUserIdsCount());

        responseObserver.onNext(RoomChangedResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    /** The WebSocket event name for a change, or null for UNSPECIFIED / unknown values. */
    static String eventFor(RoomChange change) {
        return switch (change) {
            case ROOM_ADDED -> WsEvents.ROOM_ADDED;
            case ROOM_REMOVED -> WsEvents.ROOM_REMOVED;
            case ROOM_UPDATED -> WsEvents.ROOM_UPDATED;
            default -> null;
        };
    }

    private static Long parseRoomId(String roomId) {
        try {
            return Long.valueOf(roomId);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
