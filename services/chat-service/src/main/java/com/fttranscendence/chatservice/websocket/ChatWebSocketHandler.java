package com.fttranscendence.chatservice.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Slf4j
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final SessionRegistry sessionRegistry;

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
        log.info("Message from userId={}: {}", userId, message.getPayload());
        // real routing/persistence logic comes next — this just proves the pipe works
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String userId = (String) session.getAttributes().get("userId");
        log.info("WS disconnected: userId={} status={}", userId, status);
        sessionRegistry.unregister(userId, session);
    }
}