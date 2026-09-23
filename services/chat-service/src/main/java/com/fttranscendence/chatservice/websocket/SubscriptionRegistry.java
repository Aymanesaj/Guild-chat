package com.fttranscendence.chatservice.websocket;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;
/**
 *                  SubscriptionRegistry
                         |
             ┌───────────┴───────────┐
             ↓                       ↓
     sessionsByRoom           roomsBySession
             |                       |
             ↓                       ↓
     "Who is in this room?"    "What rooms has
                                this socket joined?"
 */
/**
 * Which sockets are listening to which room.
 *
 * Two maps for the same facts, because both questions are asked often:
 *   sessionsByRoom  — "who must receive this message?" (fan-out, per message)
 *   roomsBySession  — "what must I clean up?" (per disconnect)
 * Without the second map, every disconnect would have to scan every room.
 */
@Component
public class SubscriptionRegistry {
    private final Map<Long, Set<WebSocketSession>> sessionsByRoom = new ConcurrentHashMap<>();
    private final Map<String, Set<Long>> roomsBySessionId = new ConcurrentHashMap<>();



    /** Idempotent: subscribing twice to the same room changes nothing.
     */
    public void subscribe(Long roomId , WebSocketSession session) {
        sessionsByRoom.computeIfAbsent(roomId , k -> ConcurrentHashMap.newKeySet())
        .add(session);
        roomsBySessionId
        .computeIfAbsent(session.getId(), k -> ConcurrentHashMap.newKeySet())
        .add(roomId);
    }

    /** Idempotent: unsubscribing from a room you are not in changes nothing.
     */
    public void unsubscribe(Long roomId , WebSocketSession session) {
        removeFromRoom(roomId,session.getId());

        roomsBySessionId.computeIfPresent(session.getId() , (id , rooms) -> {
            rooms.remove(roomId);
            return rooms.isEmpty() ? null : rooms;
        });
    }

    private void removeFromRoom(Long roomId , String sessionId) {
        sessionsByRoom.computeIfPresent(roomId , (id , sessions) -> {
            sessions.removeIf(session -> session.getId().equals(sessionId));
            return sessions.isEmpty() ? null : sessions;
        });
    }

    /** Called when a socket closes: drop it from every room it had joined. */
    public void removeSession(WebSocketSession session){
        Set<Long> rooms = roomsBySessionId.remove(session.getId());
        if(rooms == null) {
            return;
        }

        rooms.forEach(roomId -> removeFromRoom(roomId , session.getId()));
    }
    /**  The fan-out  target list Empty never null */
    public Set<WebSocketSession> sessionsIn(Long roomId){
        return sessionsByRoom.getOrDefault(roomId, Set.of());
    }

      // ---- for tests ----

    int subscriberCount(Long roomId) {
        return sessionsIn(roomId).size();
    }

    int roomCount() {
        return sessionsByRoom.size();
    }

    int trackedSessionCount() {
        return roomsBySessionId.size();
    }
}
