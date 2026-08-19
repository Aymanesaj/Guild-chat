package com.fttranscendence.chatservice.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ChatWebSocketHandlerTest {

    @Mock
    private SessionRegistry sessionRegistry;
    @Mock
    private RoomService roomService;
    @Mock
    private ChatMessageService chatMessageService;
    @Mock
    private WebSocketSession senderSession;
    @Mock
    private WebSocketSession recipientSession;

    private ChatWebSocketHandler handler;
    private MessageRateLimiter rateLimiter;

    private static Validator validator;

    @BeforeEach
    void setUp() {
        // A real validator, not a mock: the point of these tests is to prove the
        // constraints on IncomingMessage actually fire.
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();

        // A real rate limiter too — its arithmetic is the behaviour under test.
        rateLimiter = new MessageRateLimiter(2, 0.0001);

        handler = new ChatWebSocketHandler(
                sessionRegistry, roomService, chatMessageService, rateLimiter, validator,
                new ObjectMapper().findAndRegisterModules());
    }

    private WebSocketSession sessionFor(String userId) {
        Map<String, Object> attrs = new HashMap<>();
        attrs.put("userId", userId);
        attrs.put("username", userId + "-name");
        when(senderSession.getAttributes()).thenReturn(attrs);
        return senderSession;
    }

    /** Captures every frame written back to the sender. */
    private String capturedFrameTo(WebSocketSession session) throws Exception {
        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session).sendMessage(captor.capture());
        return captor.getValue().getPayload();
    }

    @Test
    void persistsAndBroadcasts_whenSenderIsRoomMember() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1", "user-2")).build();

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
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
        verify(recipientSession).sendMessage(argThat((TextMessage m) -> m.getPayload().contains("hi there")));
        // The sender receives it too, tagged as a MESSAGE rather than an ERROR.
        assertThat(capturedFrameTo(session)).contains("\"type\":\"MESSAGE\"").contains("hi there");
    }

    @Test
    void rejectsWithForbidden_whenSenderIsNotRoomMember() throws Exception {
        WebSocketSession session = sessionFor("intruder");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1")).build();

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
        when(roomService.isMember(room, "intruder")).thenReturn(false);
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"room-1\",\"content\":\"hi\"}"));

        verify(chatMessageService, never()).save(any(), any(), any());
        assertThat(capturedFrameTo(session)).contains("\"type\":\"ERROR\"").contains("FORBIDDEN");
    }

    @Test
    void rejectsWithRoomNotFound_whenRoomDoesNotExist() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        when(roomService.getRoomOrThrow("missing"))
                .thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found"));
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"missing\",\"content\":\"hi\"}"));

        verify(chatMessageService, never()).save(any(), any(), any());
        assertThat(capturedFrameTo(session)).contains("ROOM_NOT_FOUND");
    }

    @Test
    void rejectsWithInvalidPayload_whenFrameIsNotJson() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session, new TextMessage("not-json"));

        verifyNoInteractions(roomService, chatMessageService);
        assertThat(capturedFrameTo(session)).contains("INVALID_PAYLOAD");
    }

    @Test
    void rejectsWithValidationFailed_whenContentIsBlank() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session, new TextMessage("{\"roomId\":\"room-1\",\"content\":\"   \"}"));

        verifyNoInteractions(roomService, chatMessageService);
        assertThat(capturedFrameTo(session)).contains("VALIDATION_FAILED");
    }

    @Test
    void rejectsWithValidationFailed_whenContentExceedsMaxLength() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        when(session.isOpen()).thenReturn(true);

        String tooLong = "x".repeat(2001);
        handler.handleTextMessage(session,
                new TextMessage("{\"roomId\":\"room-1\",\"content\":\"" + tooLong + "\"}"));

        // Nothing reaches the database — the whole point of validating first.
        verifyNoInteractions(roomService, chatMessageService);
        assertThat(capturedFrameTo(session))
                .contains("VALIDATION_FAILED")
                .contains("2000 characters");
    }

    @Test
    void acceptsContentExactlyAtMaxLength() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1")).build();
        String exact = "x".repeat(2000);

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
        when(roomService.isMember(room, "user-1")).thenReturn(true);
        when(chatMessageService.save("room-1", "user-1", exact))
                .thenReturn(ChatMessage.builder().id("m1").roomId("room-1")
                        .senderId("user-1").content(exact).sentAt(Instant.now()).build());
        when(sessionRegistry.getSessions("user-1")).thenReturn(Set.of(session));
        when(session.isOpen()).thenReturn(true);

        handler.handleTextMessage(session,
                new TextMessage("{\"roomId\":\"room-1\",\"content\":\"" + exact + "\"}"));

        // Boundary check: 2000 is allowed, 2001 is not.
        verify(chatMessageService).save("room-1", "user-1", exact);
    }

    @Test
    void rejectsWithRateLimited_afterBucketIsDrained() throws Exception {
        WebSocketSession session = sessionFor("user-1");
        Room room = Room.builder().id("room-1").memberIds(List.of("user-1")).build();

        when(roomService.getRoomOrThrow("room-1")).thenReturn(room);
        when(roomService.isMember(room, "user-1")).thenReturn(true);
        when(chatMessageService.save(eq("room-1"), eq("user-1"), anyString()))
                .thenReturn(ChatMessage.builder().id("m1").roomId("room-1")
                        .senderId("user-1").content("hi").sentAt(Instant.now()).build());
        when(sessionRegistry.getSessions("user-1")).thenReturn(Set.of(session));
        when(session.isOpen()).thenReturn(true);

        TextMessage frame = new TextMessage("{\"roomId\":\"room-1\",\"content\":\"hi\"}");

        // Bucket holds 2 tokens and refills at a negligible rate.
        handler.handleTextMessage(session, frame);
        handler.handleTextMessage(session, frame);
        handler.handleTextMessage(session, frame);   // third must be refused

        verify(chatMessageService, times(2)).save(any(), any(), any());

        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, times(3)).sendMessage(captor.capture());
        assertThat(captor.getAllValues().get(2).getPayload()).contains("RATE_LIMITED");
    }

    @Test
    void rateLimitIsPerUser_notGlobal() {
        // One noisy user must not silence everyone else.
        assertThat(rateLimiter.tryConsume("user-1")).isTrue();
        assertThat(rateLimiter.tryConsume("user-1")).isTrue();
        assertThat(rateLimiter.tryConsume("user-1")).isFalse();

        assertThat(rateLimiter.tryConsume("user-2")).isTrue();
    }

    @Test
    void registersConcurrencySafeWrapper_notTheRawSession() {
        WebSocketSession session = sessionFor("user-1");

        handler.afterConnectionEstablished(session);

        ArgumentCaptor<WebSocketSession> captor = ArgumentCaptor.forClass(WebSocketSession.class);
        verify(sessionRegistry).register(eq("user-1"), captor.capture());
        // Raw sessions are not safe for concurrent writes; the decorator is.
        assertThat(captor.getValue()).isInstanceOf(ConcurrentWebSocketSessionDecorator.class);
    }

    @Test
    void afterConnectionClosed_unregistersAndReleasesRateLimitBucket() {
        WebSocketSession session = sessionFor("user-1");
        when(sessionRegistry.getSessions("user-1")).thenReturn(List.of());

        rateLimiter.tryConsume("user-1");
        handler.afterConnectionClosed(session, CloseStatus.NORMAL);

        verify(sessionRegistry).unregister("user-1", session);
        // Bucket was forgotten, so a fresh connection starts with a full one.
        assertThat(rateLimiter.tryConsume("user-1")).isTrue();
        assertThat(rateLimiter.tryConsume("user-1")).isTrue();
    }
}
