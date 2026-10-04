package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageCreatedEvent;
import com.fttranscendence.chatservice.service.MessageDeletedEvent;
import com.fttranscendence.chatservice.service.MessageEditedEvent;

/**
 * Who receives room.activity and what it carries. Synchronous executor, mocked
 * member list and sockets: no Spring, no org, no network.
 */
class ActivityNotifierTest {

    private static final long ROOM = 1L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final String CAROL = "c0000000-0000-4000-8000-000000000003";

    private RoomMembersCache roomMembers;
    private ChatWebSocketHandler sockets;
    private ActivityNotifier notifier;

    @BeforeEach
    void setUp() {
        roomMembers = mock(RoomMembersCache.class);
        sockets = mock(ChatWebSocketHandler.class);
        notifier = new ActivityNotifier(roomMembers, sockets, Runnable::run);
    }

    private static Message message(String sender) {
        return Message.create(ROOM, sender, null, "hello", "text", Instant.parse("2026-10-01T10:00:00Z"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> dataSentTo(String userId) {
        ArgumentCaptor<Object> data = ArgumentCaptor.forClass(Object.class);
        verify(sockets).sendToUser(eq(userId), eq(WsEvents.ROOM_ACTIVITY), data.capture());
        return (Map<String, Object>) data.getValue();
    }

    @Test
    @DisplayName("every member gets room.activity, the sender included (their other tabs)")
    void everyMemberIsNotified() {
        when(roomMembers.members(ROOM, ALICE)).thenReturn(List.of(ALICE, BOB, CAROL));

        notifier.onCreated(new MessageCreatedEvent(message(ALICE)));

        verify(sockets).sendToUser(eq(ALICE), eq(WsEvents.ROOM_ACTIVITY), any());
        verify(sockets).sendToUser(eq(BOB), eq(WsEvents.ROOM_ACTIVITY), any());
        verify(sockets).sendToUser(eq(CAROL), eq(WsEvents.ROOM_ACTIVITY), any());
    }

    @Test
    @DisplayName("a new message carries room_id, change 'new' and the same DTO as REST")
    void newMessagePayload() {
        when(roomMembers.members(ROOM, ALICE)).thenReturn(List.of(BOB));
        Message message = message(ALICE);

        notifier.onCreated(new MessageCreatedEvent(message));

        Map<String, Object> data = dataSentTo(BOB);
        assertThat(data).containsEntry("room_id", ROOM).containsEntry("change", "new");
        assertThat(data.get("message")).isEqualTo(MessageResponse.from(message));
    }

    @Test
    @DisplayName("edits are announced as change 'edited'")
    void editedPayload() {
        when(roomMembers.members(ROOM, ALICE)).thenReturn(List.of(BOB));

        notifier.onEdited(new MessageEditedEvent(message(ALICE)));

        assertThat(dataSentTo(BOB)).containsEntry("change", "edited");
    }

    @Test
    @DisplayName("deletes are announced as change 'deleted', with the content hidden")
    void deletedPayload() {
        when(roomMembers.members(ROOM, ALICE)).thenReturn(List.of(BOB));
        Message message = message(ALICE);
        message.markDeleted(Instant.parse("2026-10-01T10:01:00Z"));

        notifier.onDeleted(new MessageDeletedEvent(message));

        Map<String, Object> data = dataSentTo(BOB);
        assertThat(data).containsEntry("change", "deleted");
        assertThat(((MessageResponse) data.get("message")).content()).isNull();
    }

    @Test
    @DisplayName("org unreachable: the activity is dropped, nothing is thrown at the sender")
    void orgFailureIsSwallowed() {
        when(roomMembers.members(anyLong(), anyString()))
                .thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "down"));

        notifier.onCreated(new MessageCreatedEvent(message(ALICE)));

        verify(sockets, never()).sendToUser(any(), any(), any());
    }

    @Test
    @DisplayName("the member list is requested as the message's sender, a known member")
    void asksAsSender() {
        when(roomMembers.members(ROOM, BOB)).thenReturn(List.of(ALICE));

        notifier.onCreated(new MessageCreatedEvent(message(BOB)));

        verify(roomMembers).members(ROOM, BOB);
    }
}
