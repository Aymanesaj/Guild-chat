
package com.fttranscendence.chatservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fttranscendence.chat.grpc.ChatNotifyServiceGrpc;
import com.fttranscendence.chat.grpc.DeleteRoomRequest;
import com.fttranscendence.chat.grpc.DeleteRoomResponse;
import com.fttranscendence.chat.grpc.RoomChange;
import com.fttranscendence.chat.grpc.RoomChangedRequest;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;
import com.fttranscendence.chatservice.websocket.WsEvents;

import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;

class ChatNotifyGrpcServiceTest {

    private static final String ALICE =
            "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    private static final String BOB =
            "b7c1d2e3-0000-4000-8000-000000000002";

    private ChatWebSocketHandler sockets;
    private RoomMembersCache roomMembers;
    private MessageRepository messageRepository;

    private Server server;
    private ManagedChannel channel;

    private ChatNotifyServiceGrpc.ChatNotifyServiceBlockingStub stub;

    @BeforeEach
    void setUp() throws Exception {
        sockets = mock(ChatWebSocketHandler.class);
        roomMembers = mock(RoomMembersCache.class);
        messageRepository = mock(MessageRepository.class);

        String name = InProcessServerBuilder.generateName();

        server = InProcessServerBuilder.forName(name)
                .addService(new ChatNotifyGrpcService(
                        sockets,
                        roomMembers,
                        messageRepository))
                .build()
                .start();

        channel = InProcessChannelBuilder.forName(name).build();

        stub = ChatNotifyServiceGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void tearDown() {
        channel.shutdownNow();
        server.shutdownNow();
    }

    private static RoomChangedRequest request(
            String roomId,
            RoomChange change,
            String... userIds) {

        return RoomChangedRequest.newBuilder()
                .setRoomId(roomId)
                .setChange(change)
                .addAllUserIds(List.of(userIds))
                .build();
    }

    // RoomChanged tests

    @Test
    @DisplayName("ROOM_ADDED notifies every listed user")
    void addedReachesEveryUser() {
        stub.roomChanged(
                request("7", RoomChange.ROOM_ADDED, ALICE, BOB));

        verify(sockets).sendToUser(
                ALICE,
                WsEvents.ROOM_ADDED,
                Map.of("room_id", 7L));

        verify(sockets).sendToUser(
                BOB,
                WsEvents.ROOM_ADDED,
                Map.of("room_id", 7L));
    }

    @Test
    @DisplayName("Each room change maps to its own WebSocket event")
    void mapsEveryChange() {
        assertThat(ChatNotifyGrpcService.eventFor(RoomChange.ROOM_ADDED))
                .isEqualTo(WsEvents.ROOM_ADDED);

        assertThat(ChatNotifyGrpcService.eventFor(RoomChange.ROOM_REMOVED))
                .isEqualTo(WsEvents.ROOM_REMOVED);

        assertThat(ChatNotifyGrpcService.eventFor(RoomChange.ROOM_UPDATED))
                .isEqualTo(WsEvents.ROOM_UPDATED);

        assertThat(ChatNotifyGrpcService.eventFor(
                RoomChange.ROOM_CHANGE_UNSPECIFIED))
                .isNull();
    }

    @Test
    @DisplayName("Room change invalidates the member cache")
    void invalidatesMembers() {
        stub.roomChanged(
                request("7", RoomChange.ROOM_UPDATED, ALICE));

        verify(roomMembers).invalidate(7L);
    }

    @Test
    @DisplayName("Non-numeric room ID is rejected")
    void rejectsBadRoomId() {
        assertThatThrownBy(() ->
                stub.roomChanged(
                        request("abc", RoomChange.ROOM_ADDED, ALICE)))
                .isInstanceOfSatisfying(
                        StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode())
                                .isEqualTo(Status.Code.INVALID_ARGUMENT));

        verify(sockets, never()).sendToUser(any(), any(), any());
        verify(roomMembers, never()).invalidate(anyLong());
    }

    @Test
    @DisplayName("Unspecified room change is rejected")
    void rejectsUnspecifiedChange() {
        assertThatThrownBy(() ->
                stub.roomChanged(
                        request(
                                "7",
                                RoomChange.ROOM_CHANGE_UNSPECIFIED,
                                ALICE)))
                .isInstanceOfSatisfying(
                        StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode())
                                .isEqualTo(Status.Code.INVALID_ARGUMENT));

        verify(sockets, never()).sendToUser(any(), any(), any());
    }

    @Test
    @DisplayName("Empty user list still invalidates the cache")
    void emptyUserList() {
        stub.roomChanged(
                request("7", RoomChange.ROOM_REMOVED));

        verify(roomMembers).invalidate(7L);

        verify(sockets, never()).sendToUser(
                any(),
                eq(WsEvents.ROOM_REMOVED),
                any());
    }

    // DeleteRoom tests

    @Test
    @DisplayName("DeleteRoom deletes messages and invalidates the cache")
    void deleteRoomDeletesMessages() {
        when(messageRepository.deleteByRoomId("7"))
                .thenReturn(3L);

        DeleteRoomResponse response = stub.deleteRoom(
                DeleteRoomRequest.newBuilder()
                        .setRoomId("7")
                        .build());

        assertThat(response.getDeletedMessages()).isEqualTo(3L);

        verify(messageRepository).deleteByRoomId("7");
        verify(roomMembers).invalidate(7L);
        verifyNoInteractions(sockets);
    }

    @Test
    @DisplayName("DeleteRoom succeeds when the room has no messages")
    void deleteRoomWithNoMessages() {
        when(messageRepository.deleteByRoomId("7"))
                .thenReturn(0L);

        DeleteRoomResponse response = stub.deleteRoom(
                DeleteRoomRequest.newBuilder()
                        .setRoomId("7")
                        .build());

        assertThat(response.getDeletedMessages()).isZero();

        verify(messageRepository).deleteByRoomId("7");
        verify(roomMembers).invalidate(7L);
    }

    @Test
    @DisplayName("DeleteRoom rejects an empty room ID")
    void deleteRoomRejectsEmptyId() {
        assertThatThrownBy(() ->
                stub.deleteRoom(
                        DeleteRoomRequest.newBuilder()
                                .setRoomId("")
                                .build()))
                .isInstanceOfSatisfying(
                        StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode())
                                .isEqualTo(Status.Code.INVALID_ARGUMENT));

        verifyNoInteractions(messageRepository);
        verify(roomMembers, never()).invalidate(anyLong());
        verifyNoInteractions(sockets);
    }

    @Test
    @DisplayName("DeleteRoom reports repository failures")
    void deleteRoomReportsRepositoryFailure() {
        when(messageRepository.deleteByRoomId("7"))
                .thenThrow(
                        new RuntimeException("Database unavailable"));

        assertThatThrownBy(() ->
                stub.deleteRoom(
                        DeleteRoomRequest.newBuilder()
                                .setRoomId("7")
                                .build()))
                .isInstanceOfSatisfying(
                        StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode())
                                .isEqualTo(Status.Code.INTERNAL));

        verify(messageRepository).deleteByRoomId("7");
        verify(roomMembers, never()).invalidate(anyLong());
    }
}
