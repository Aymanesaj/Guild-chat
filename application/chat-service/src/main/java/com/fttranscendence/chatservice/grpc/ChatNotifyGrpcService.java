
package com.fttranscendence.chatservice.grpc;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fttranscendence.chat.grpc.ChatNotifyServiceGrpc;
import com.fttranscendence.chat.grpc.DeleteRoomRequest;
import com.fttranscendence.chat.grpc.DeleteRoomResponse;
import com.fttranscendence.chat.grpc.RoomChange;
import com.fttranscendence.chat.grpc.RoomChangedRequest;
import com.fttranscendence.chat.grpc.RoomChangedResponse;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.WsEvents;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;

@Component
public class ChatNotifyGrpcService
        extends ChatNotifyServiceGrpc.ChatNotifyServiceImplBase {

    private static final Logger log =
            LoggerFactory.getLogger(ChatNotifyGrpcService.class);

    private final ChatWebSocketHandler sockets;
    private final RoomMembersCache roomMembers;
    private final MessageRepository messageRepository;

    public ChatNotifyGrpcService(
            ChatWebSocketHandler sockets,
            RoomMembersCache roomMembers,
            MessageRepository messageRepository) {

        this.sockets = sockets;
        this.roomMembers = roomMembers;
        this.messageRepository = messageRepository;
    }

    /**
     * Notifies affected users about a room change.
     * Invalidates the cached member list and sends the corresponding
     * WebSocket event to every listed user's open sockets.
     */
    @Override
    public void roomChanged(
            RoomChangedRequest request,
            StreamObserver<RoomChangedResponse> responseObserver) {

        Long roomId = parseRoomId(request.getRoomId());
        String event = eventFor(request.getChange());

        if (roomId == null || event == null) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT
                            .withDescription(
                                    "room_id must be a number and change must be set")
                            .asRuntimeException());
            return;
        }

        roomMembers.invalidate(roomId);

        Map<String, Object> data = Map.of("room_id", roomId);

        request.getUserIdsList().forEach(
                userId -> sockets.sendToUser(userId, event, data));

        log.debug(
                "{} room={} users={}",
                event,
                roomId,
                request.getUserIdsCount());

        responseObserver.onNext(
                RoomChangedResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    /**
     * Deletes all chat messages belonging to a room deleted by org-service.
     * The actual room remains the responsibility of org-service.
     */
    @Override
    public void deleteRoom(
            DeleteRoomRequest request,
            StreamObserver<DeleteRoomResponse> responseObserver) {

        String roomId = request.getRoomId();

        if (roomId.isBlank()) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT
                            .withDescription("room_id must not be empty")
                            .asRuntimeException());
            return;
        }

        try {
            long deletedMessages =
                    messageRepository.deleteByRoomId(roomId);

            Long numericRoomId = parseRoomId(roomId);

            if (numericRoomId != null) {
                roomMembers.invalidate(numericRoomId);
            }

            DeleteRoomResponse response =
                    DeleteRoomResponse.newBuilder()
                            .setDeletedMessages(deletedMessages)
                            .build();

            log.info(
                    "Deleted chat messages for room={} count={}",
                    roomId,
                    deletedMessages);

            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (Exception e) {
            log.error(
                    "DeleteRoom failed for room={}",
                    roomId,
                    e);

            responseObserver.onError(
                    Status.INTERNAL
                            .withDescription(
                                    "Failed to delete room messages")
                            .withCause(e)
                            .asRuntimeException());
        }
    }

    /**
     * Maps a room change to its WebSocket event name.
     */
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
