package com.fttranscendence.chatservice.websocket;

import java.util.Collection;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

/**
 * Who is connected right now, and over which sockets.
 *
 * One user maps to many sessions: a second browser tab is a second socket, and
 * both must receive the room's messages.
 *
 * Sessions are keyed by {@link WebSocketSession#getId()} rather than held in a
 * Set of session objects. The reason is concrete: what we register is a
 * ConcurrentWebSocketSessionDecorator wrapping the real session, but Spring
 * hands the RAW session back to afterConnectionClosed. The decorator is not
 * equal to the object it wraps, so a Set.remove(rawSession) would silently fail
 * and the entry would leak for the lifetime of the process. Ids are stable
 * across the wrapper (the decorator delegates getId()), so they match.
 *
 * This map lives in one JVM's heap — see MessageRateLimiter for what that
 * means when a second instance appears.
 */
@Component
public class SessionRegistry {

    private final ConcurrentHashMap<String, Map<String, WebSocketSession>> userSessions = new ConcurrentHashMap<>();

    public void register(String userId, WebSocketSession session) {
        userSessions
                .computeIfAbsent(userId, id -> new ConcurrentHashMap<>())
                .put(session.getId(), session);
    }

    /**
     * Remove one socket. Accepts the raw session; only its id is used.
     *
     * The removal and the "is it now empty?" check run inside a single
     * {@code compute}, so the whole operation is atomic with respect to a
     * concurrent {@link #register}. Doing it as two separate calls would leave
     * a window where a user reconnecting at that instant could have their fresh
     * session map dropped.
     */
    public void unregister(String userId, WebSocketSession session) {
        userSessions.compute(userId, (id, sessions) -> {
            if (sessions == null) {
                return null;
            }
            sessions.remove(session.getId());
            return sessions.isEmpty() ? null : sessions;
        });
    }

    public Collection<WebSocketSession> getSessions(String userId) {
        Map<String, WebSocketSession> sessions = userSessions.get(userId);
        return sessions == null ? Collections.emptyList() : sessions.values();
    }

    public boolean isOnline(String userId) {
        return userSessions.containsKey(userId);
    }
}
