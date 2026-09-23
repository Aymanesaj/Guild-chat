package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.WebSocketSession;

import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageCreatedEvent;

/**
 * Who receives a message.new, with a real registry and a mocked FrameSender:
 * no Spring, no sockets.
 */
class RoomBroadcasterTest {

    private static final long ROOM = 1L;
    private static final long OTHER_ROOM = 2L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    private SubscriptionRegistry registry;
    private FrameSender frameSender;
    private RoomBroadcaster broadcaster;

    @BeforeEach
    void setUp() {
        registry = new SubscriptionRegistry();
        frameSender = mock(FrameSender.class);
        broadcaster = new RoomBroadcaster(registry, frameSender);
    }

    private static WebSocketSession session(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        return session;
    }

    private static MessageCreatedEvent created(long roomId) {
        return new MessageCreatedEvent(
                Message.create(roomId, ALICE, null, "hello", "text", Instant.parse("2026-09-22T10:00:00Z")));
    }

    @Test
    @DisplayName("every socket subscribed to the room receives message.new")
    void sendsToEverySubscriber() {
        WebSocketSession tab1 = session("s1");
        WebSocketSession tab2 = session("s2");
        registry.subscribe(ROOM, tab1);
        registry.subscribe(ROOM, tab2);

        broadcaster.onCreated(created(ROOM));

        verify(frameSender).send(eq(tab1), eq(WsEvents.MESSAGE_NEW), any(MessageResponse.class));
        verify(frameSender).send(eq(tab2), eq(WsEvents.MESSAGE_NEW), any(MessageResponse.class));
    }

    @Test
    @DisplayName("sockets subscribed only to other rooms receive nothing")
    void otherRoomsAreNotTouched() {
        WebSocketSession elsewhere = session("s1");
        registry.subscribe(OTHER_ROOM, elsewhere);

        broadcaster.onCreated(created(ROOM));

        verify(frameSender, never()).send(eq(elsewhere), any(), any());
    }

    @Test
    @DisplayName("a room with no subscribers sends nothing")
    void emptyRoomSendsNothing() {
        broadcaster.onCreated(created(ROOM));

        verifyNoInteractions(frameSender);
    }

    @Test
    @DisplayName("the payload is the REST DTO built from the stored message")
    void payloadIsTheRestDto() {
        registry.subscribe(ROOM, session("s1"));

        broadcaster.onCreated(created(ROOM));

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(frameSender).send(any(), eq(WsEvents.MESSAGE_NEW), payload.capture());
        assertThat(payload.getValue()).isInstanceOfSatisfying(MessageResponse.class, dto -> {
            assertThat(dto.roomId()).isEqualTo(ROOM);
            assertThat(dto.senderId()).isEqualTo(ALICE);
            assertThat(dto.content()).isEqualTo("hello");
        });
    }
}
