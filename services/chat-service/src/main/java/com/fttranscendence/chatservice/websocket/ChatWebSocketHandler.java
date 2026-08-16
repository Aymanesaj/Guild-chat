package com.fttranscendence.chatservice.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.dto.ErrorFrame;
import com.fttranscendence.chatservice.message.dto.IncomingMessage;
import com.fttranscendence.chatservice.message.dto.OutgoingMessage;
import com.fttranscendence.chatservice.message.dto.WsErrorCode;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {

    /** Give up on a socket that cannot absorb 5s or 512 KB of backlog. */
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int SEND_BUFFER_SIZE_LIMIT = 512 * 1024;

    private final SessionRegistry sessionRegistry;
    private final RoomService roomService;
    private final ChatMessageService chatMessageService;
    private final MessageRateLimiter rateLimiter;
    private final Validator validator;
    private final ObjectMapper objectMapper;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String userId = (String) session.getAttributes().get("userId");
        String username = (String) session.getAttributes().get("username");
        log.info("WS connected: userId={} username={} sessionId={}", userId, username, session.getId());

        // Wrap before storing, so every writer anywhere in the app goes through
        // the decorator. See the class comment on why raw sessions are unsafe.
        sessionRegistry.register(userId, new ConcurrentWebSocketSessionDecorator(
                session, SEND_TIME_LIMIT_MS, SEND_BUFFER_SIZE_LIMIT));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String userId = (String) session.getAttributes().get("userId");
        String username = (String) session.getAttributes().get("username");

        IncomingMessage incoming;
        try {
            incoming = objectMapper.readValue(message.getPayload(), IncomingMessage.class);
        } catch (IOException e) {
            log.warn("Malformed frame from userId={}: {}", userId, e.getMessage());
            sendError(session, WsErrorCode.INVALID_PAYLOAD, "Frame is not valid JSON for a chat message");
            return;
        }

        // A WebSocket frame never passes through Spring MVC, so nothing has run
        // the Bean Validation constraints on IncomingMessage. We invoke the
        // validator ourselves — this is the WS equivalent of @Valid.
        Set<ConstraintViolation<IncomingMessage>> violations = validator.validate(incoming);
        if (!violations.isEmpty()) {
            String detail = violations.stream()
                    .map(ConstraintViolation::getMessage)
                    .collect(Collectors.joining("; "));
            log.warn("Invalid message from userId={}: {}", userId, detail);
            sendError(session, WsErrorCode.VALIDATION_FAILED, detail);
            return;
        }

        // Rate limit before doing any database work: the point is to protect
        // MongoDB from a flood, so the check has to come first.
        if (!rateLimiter.tryConsume(userId)) {
            log.warn("Rate limit exceeded by userId={}", userId);
            sendError(session, WsErrorCode.RATE_LIMITED, "Too many messages, slow down");
            return;
        }

        Room room;
        try {
            room = roomService.getRoomOrThrow(incoming.getRoomId());
        } catch (ResponseStatusException e) {
            if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                sendError(session, WsErrorCode.ROOM_NOT_FOUND, "No such room");
                return;
            }
            throw e;
        }

        if (!roomService.isMember(room, userId)) {
            log.warn("userId={} is not a member of roomId={}", userId, incoming.getRoomId());
            sendError(session, WsErrorCode.FORBIDDEN, "You are not a member of this room");
            return;
        }

        ChatMessage saved;
        try {
            saved = chatMessageService.save(room.getId(), userId, incoming.getContent());
        } catch (RuntimeException e) {
            // Never leak the exception text to the client — it can carry
            // driver internals, connection strings, or collection names.
            log.error("Failed to persist message for userId={}: {}", userId, e.getMessage(), e);
            sendError(session, WsErrorCode.SERVER_ERROR, "Could not save message");
            return;
        }

        OutgoingMessage outgoing = OutgoingMessage.builder()
                .id(saved.getId())
                .roomId(saved.getRoomId())
                .senderId(saved.getSenderId())
                .senderUsername(username)
                .content(saved.getContent())
                .sentAt(saved.getSentAt())
                .build();

        broadcast(room, outgoing);
    }

    private void broadcast(Room room, OutgoingMessage outgoing) {
        String payload;
        try {
            payload = objectMapper.writeValueAsString(outgoing);
        } catch (IOException e) {
            log.error("Failed to serialize outgoing message: {}", e.getMessage());
            return;
        }

        TextMessage textMessage = new TextMessage(payload);
        for (String memberId : room.getMemberIds()) {
            for (WebSocketSession memberSession : sessionRegistry.getSessions(memberId)) {
                try {
                    if (memberSession.isOpen()) {
                        memberSession.sendMessage(textMessage);
                    }
                } catch (IOException e) {
                    log.warn("Failed to deliver to userId={} sessionId={}: {}",
                            memberId, memberSession.getId(), e.getMessage());
                }
            }
        }
    }

    /** Send an error only to the client that caused it. Best effort. */
    private void sendError(WebSocketSession session, WsErrorCode code, String detail) {
        try {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(
                        objectMapper.writeValueAsString(new ErrorFrame(code, detail))));
            }
        } catch (IOException e) {
            log.warn("Could not deliver error frame to sessionId={}: {}", session.getId(), e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String userId = (String) session.getAttributes().get("userId");
        log.info("WS disconnected: userId={} status={}", userId, status);
        sessionRegistry.unregister(userId, session);

        // Release the rate-limit bucket once the user has no sessions left.
        if (sessionRegistry.getSessions(userId).isEmpty()) {
            rateLimiter.forget(userId);
        }
    }
}
