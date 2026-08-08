package com.fttranscendence.chatservice.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.message.domain.ChatMessage;
import com.fttranscendence.chatservice.message.domain.Room;
import com.fttranscendence.chatservice.message.dto.IncomingMessage;
import com.fttranscendence.chatservice.message.dto.OutgoingMessage;
import com.fttranscendence.chatservice.message.repository.RoomRepository;
import com.fttranscendence.chatservice.message.service.ChatMessageService;
import com.fttranscendence.chatservice.message.service.RoomService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final SessionRegistry sessionRegistry;
    private final RoomRepository roomRepository;
    private final RoomService roomService;
    private final ChatMessageService chatMessageService;
    private final ObjectMapper objectMapper;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String userId = (String) session.getAttributes().get("userId");
        String username = (String) session.getAttributes().get("username");
        log.info("WS connected: userId={} username={} sessionId={}", userId, username, session.getId());
        sessionRegistry.register(userId, session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String userId = (String) session.getAttributes().get("userId");
        String username = (String) session.getAttributes().get("username");

        IncomingMessage incoming;
        try {
            incoming = objectMapper.readValue(message.getPayload(), IncomingMessage.class);
        } catch (IOException e) {
            log.warn("Dropping malformed message from userId={}: {}", userId, e.getMessage());
            return;
        }

        if (incoming.getRoomId() == null || incoming.getContent() == null || incoming.getContent().isBlank()) {
            log.warn("Dropping invalid message from userId={}: missing roomId/content", userId);
            return;
        }

        Optional<Room> roomOpt = roomRepository.findById(incoming.getRoomId());
        if (roomOpt.isEmpty() || !roomService.isMember(roomOpt.get(), userId)) {
            log.warn("Rejected message: userId={} is not a member of roomId={}", userId, incoming.getRoomId());
            return;
        }
        Room room = roomOpt.get();

        ChatMessage saved = chatMessageService.save(room.getId(), userId, incoming.getContent());

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
                    log.warn("Failed to deliver message to userId={} sessionId={}: {}",
                            memberId, memberSession.getId(), e.getMessage());
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String userId = (String) session.getAttributes().get("userId");
        log.info("WS disconnected: userId={} status={}", userId, status);
        sessionRegistry.unregister(userId, session);
    }
}