package com.fttranscendence.chatservice.websocket;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * One connection per browser tab, covering every room the user is in.
 *
 * A frame never passes through Spring MVC: no @RequestMapping, no @Valid, no
 * @RestControllerAdvice. JSON is parsed by hand and errors are written as
 * frames, because there is no status code left to return.
 */


@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketHandler.class);

    /** One user, many connections: laptop, phone, three tabs. */
    private final Map<String , Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String userId =userId(session);

        // WebSocketSession.sendMessage is NOT thread-safe; two threads writing
        // one socket corrupt the frame stream. The decorator serialises writes
        // and bounds the buffer for slow clients.
        WebSocketSession guarded = new ConcurrentWebSocketSessionDecorator(session , 5_000 , 512 * 1024);
        Set<WebSocketSession> sessions = sessionsByUser.computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet());
        sessions.add(guarded);
        log.debug("WebSocket opened: user={} sessions={}" , userId, sessions.size());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        // Next step: subscribe / unsubscribe / typing.
        log.debug("frame from user={} length={}", userId(session), message.getPayloadLength());
    }
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("WebSocket transport error for user={}", userId(session), exception);
        remove(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        remove(session);
        log.debug("WebSocket closed: user={} status={}", userId(session), status.getCode());
    }

    /** Idempotent, and must not leave empty sets behind: a hard drop may never call this. */
    private void remove(WebSocketSession session) {
        String userId = userId(session);
        if (userId == null) {
            return;
        }

        sessionsByUser.computeIfPresent(userId, (id, sessions) -> {
            sessions.removeIf(existing -> sameConnection(existing, session));
            return sessions.isEmpty() ? null : sessions;
        });
    }
    /** The registry holds decorators, so compare by the underlying session id. */
    private boolean sameConnection(WebSocketSession a, WebSocketSession b) {
        return a.getId().equals(b.getId());
    }

    private String userId(WebSocketSession session) {
        Object userId = session.getAttributes().get(TokenHandshakeInterceptor.USER_ID_ATTRIBUTE);
        return userId == null ? null : userId.toString();
    }

    /** For tests and, soon, the broadcaster. */
    int connectionCount(String userId) {
        Set<WebSocketSession> sessions = sessionsByUser.get(userId);
        return sessions == null ? 0 : sessions.size();
    }


}
