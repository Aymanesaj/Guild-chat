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

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.OrgClient;

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


    /** The write-serialising wrapper for this connection, created once at connect. */
    static final String GUARDED_SESSION_ATTRIBUTE = "chat.guardedSession";
    /** One user, many connections: laptop, phone, three tabs. */
    private final Map<String , Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();


    private final FrameSender frameSender ;
    private final ObjectMapper objectMapper;

    private final SubscriptionRegistry subscriptionRegistry;
    private final OrgClient orgClient;
    private final PresenceRegistry presenceRegistry;

    public ChatWebSocketHandler(FrameSender frameSender,  ObjectMapper objectMapper , SubscriptionRegistry subscriptionRegistry, OrgClient orgClient,
            PresenceRegistry presenceRegistry) {
        this.frameSender = frameSender;
        this.objectMapper = objectMapper;
        this.subscriptionRegistry = subscriptionRegistry;
        this.orgClient = orgClient;
        this.presenceRegistry = presenceRegistry;
    }

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
        session.getAttributes().put(GUARDED_SESSION_ATTRIBUTE, guarded);
        presenceRegistry.connected(userId, session.getId());
    }

    static final int MAX_FRAMES_PER_SECOND = 20 ;
    static final String RATE_ATTRIBUTE = "chat.frameRate";
    /** [0]  = window start (ms) , [1] = frames in window */
    private boolean overRate(WebSocketSession session) {
        long now = System.currentTimeMillis();
        long[] rate = (long[]) session.getAttributes()
        .computeIfAbsent(RATE_ATTRIBUTE, k -> new long[] {now , 0});
        if ( now - rate[0] > 1_000) {
            rate[0] = now;
            rate[1] = 0;
        }
        return ++rate[1] > MAX_FRAMES_PER_SECOND;
    }
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        JsonNode frame;
        if(overRate(session)) {
            frameSender.sendError(guarded(session), "RATE_LIMIT_EXCEEDED" , "Too many frames per second");
            session.close(CloseStatus.POLICY_VIOLATION);

            return ;
        }
        try {
            frame = objectMapper.readTree(message.getPayload());
        } catch (JsonProcessingException e) {
            frameSender.sendError(guarded(session), "INVALID_JSON" , "Frame is not valid JSON");
            return ;
        }

        String event = frame.path("event").asText(null);
        JsonNode data = frame.path("data");

        if (event == null || event.isBlank()) {
            frameSender.sendError(guarded(session), "MISSING_EVENT" , "Frame is missing 'event' field");
            return ;
        }

        switch (event) {
            case WsEvents.SUBSCRIBE -> subscribe(session, data);
            case WsEvents.UNSUBSCRIBE -> unsubscribe(session, data);
            default -> frameSender.sendError(guarded(session), "UNKNOWN_EVENT" , "Unknown event: "+ event);
        }
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
        subscriptionRegistry.removeSession(session);
        String userId = userId(session);
        if (userId == null) {
            return;
        }
        presenceRegistry.disconnected(userId, session.getId());

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

    /** Joining a room's live feed. The membership check that matters: without
     * it, any authenticated user could listen to any room in real time.
     */
    private void subscribe(WebSocketSession session, JsonNode data) {
        Long roomId = roomId(session, data);
        if (roomId == null) {
            return;
        }
        String userId = userId(session);

        try {
            if (!orgClient.isMember(userId, roomId)) {
                frameSender.sendError(guarded(session), "NOT_A_MEMBER", "You are not a member of this room");
                return;
            }
        } catch (ApiException e) {
            // org unreachable: refuse rather than guess. Guessing "member"
            // leaks a room; guessing "not a member" hides a real one.
            frameSender.sendError(guarded(session), e.getCode(), e.getMessage());
            return;
        }

        WebSocketSession target = guarded(session);
        subscriptionRegistry.subscribe(roomId, target);
        // The gRPC call above can take up to its deadline. If the socket closed
        // meanwhile, afterConnectionClosed has already cleaned up and nothing
        // would ever remove this entry.
        if (!session.isOpen()) {
            subscriptionRegistry.unsubscribe(roomId, target);
            return;
        }
        log.debug("user={} subscribed to room={}", userId, roomId);
    }

    /** No membership check: leaving is always allowed, even after being kicked. */
    private void unsubscribe(WebSocketSession session, JsonNode data) {
        Long roomId = roomId(session, data);
        if (roomId == null) {
            return;
        }
        subscriptionRegistry.unsubscribe(roomId, guarded(session));
        log.debug("user={} unsubscribed from room={}", userId(session), roomId);
    }

    /** Reads data.room_id, or sends an error frame and returns null. */
    private Long roomId(WebSocketSession session, JsonNode data) {
        JsonNode roomId = data.path("room_id");

        if (roomId.isMissingNode() || roomId.isNull()) {
            frameSender.sendError(guarded(session), "MISSING_ROOM_ID", "'room_id' is required");
            return null;
        }
        // isIntegralNumber rejects "42" (a string) and 42.7, which
        // canConvertToLong alone would silently truncate to room 42.
        if (!roomId.isIntegralNumber() || !roomId.canConvertToLong()) {
            frameSender.sendError(guarded(session), "INVALID_ROOM_ID", "'room_id' must be an integer");
            return null;
        }
        return roomId.asLong();
    }

    /** The write-serialising wrapper, so no write ever goes to the raw session. */
    private WebSocketSession guarded(WebSocketSession session) {
        Object guarded = session.getAttributes().get(GUARDED_SESSION_ATTRIBUTE);
        return guarded instanceof WebSocketSession wrapped ? wrapped : session;
    }
}
