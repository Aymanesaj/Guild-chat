package com.fttranscendence.chatservice.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.repository.RoomRepository;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ChatWebSocketHandlerTest {

    @Mock
    private SessionRegistry sessionRegistry;
    @Mock
    private RoomRepository roomRepository;
    @Mock
    private RoomService roomService;
    @Mock
    private ChatMessageService chatMessageService;
    @Mock
    private WebSocketSession senderSession;
    @Mock
    private WebSocketSession recipientSession;

    private ChatWebSocketHandler handler;

    @BeforeEach
    void setUp() {
        handler = new ChatWebSocketHandler(
                sessionRegistry, roomRepository, roomService, chatMessageService,
                new ObjectMapper().findAndRegisterModules());
    }

    private WebSocketSession sessionFor(String userId) {
        Map<String, Object> attrs = new HashMap<>();
        attrs.put("userId", userId);
        attrs.put("username", userId + "-name");
        when(senderSession.getAttributes()).thenReturn(attrs);
        return senderSession;
    }

    @Test
    void handleTextMessage_persistsAndBroadcasts_whenSenderIsRoomMember() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1", "user-2")).build();

        when(roomRepository.findById("room-1")).thenReturn(Optional.of(room));
        when(roomService.isMember(room, "user-1")).thenReturn(true);
        when(chatMessageService.save("room-1", "user-1", "hi there"))
                .thenReturn(ChatMessage.builder()
                        .id("m1").roomId("room-1").senderId("user-1")
                        .content("hi there").sentAt(Instant.now()).build());
        when(sessionRegistry.getSessions("user-1")).thenReturn(Set.of(session));
        when(sessionRegistry.getSessions("user-2")).thenReturn(Set.of(recipientSession));
        when(recipientSession.isOpen()).thenReturn(true);
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"room-1\",\"content\":\"hi there\"}"));

        verify(chatMessageService).save("room-1", "user-1", "hi there");
        verify(recipientSession).sendMessage(argThat((TextMessage msg) -> msg.getPayload().contains("hi there")));
        verify(session).sendMessage(any(TextMessage.class));
    }

    @Test
    void handleTextMessage_dropsMessage_whenSenderIsNotRoomMember() throws Exception {
        WebSocketSession session = sessionFor("intruder");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1", "user-2")).build();

        when(roomRepository.findById("room-1")).thenReturn(Optional.of(room));
        when(roomService.isMember(room, "intruder")).thenReturn(false);

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"room-1\",\"content\":\"hi\"}"));

        verify(chatMessageService, never()).save(any(), any(), any());
        verifyNoInteractions(sessionRegistry);
    }

    @Test
    void handleTextMessage_dropsMessage_whenRoomDoesNotExist() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        when(roomRepository.findById("missing")).thenReturn(Optional.empty());

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"missing\",\"content\":\"hi\"}"));

        verify(chatMessageService, never()).save(any(), any(), any());
    }

    @Test
    void handleTextMessage_dropsMessage_whenPayloadIsMalformedJson() throws Exception {
        WebSocketSession session = sessionFor("user-1");

        handler.handleTextMessage(session, new TextMessage("not-json"));

        verifyNoInteractions(roomRepository, chatMessageService, sessionRegistry);
    }

    @Test
    void handleTextMessage_dropsMessage_whenContentIsBlank() throws Exception {
        WebSocketSession session = sessionFor("user-1");

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"room-1\",\"content\":\"   \"}"));

        verifyNoInteractions(roomRepository, chatMessageService, sessionRegistry);
    }

    @Test
    void afterConnectionEstablished_registersSession() {
        WebSocketSession session = sessionFor("user-1");
        handler.afterConnectionEstablished(session);
        verify(sessionRegistry).register("user-1", session);
    }

    @Test
    void afterConnectionClosed_unregistersSession() {
        WebSocketSession session = sessionFor("user-1");
        handler.afterConnectionClosed(session, org.springframework.web.socket.CloseStatus.NORMAL);
        verify(sessionRegistry).unregister("user-1", session);
    }
}
