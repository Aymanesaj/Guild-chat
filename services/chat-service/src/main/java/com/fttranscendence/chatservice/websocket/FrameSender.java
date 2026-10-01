package com.fttranscendence.chatservice.websocket;



import java.io.IOException;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.SessionLimitExceededException;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Writes {"event": ..., "data": ...} frames.
 *
 * Uses Boot's ObjectMapper, so frames are serialised with the same snake_case
 * strategy as the REST responses — a message object looks identical on both.
 */
@Component
public class FrameSender {

    private static final Logger log = LoggerFactory.getLogger(FrameSender.class);

    private final ObjectMapper objectMapper;

    public FrameSender(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Sends one frame. A failed write is logged, never thrown: one dead
     * recipient must not abort a broadcast to everyone else.
     */
    public void send(WebSocketSession session, String event, Object data) {
        if (!session.isOpen()) {
            return;
        }

        try {
            String json = objectMapper.writeValueAsString(Map.of("event", event, "data", data));
            session.sendMessage(new TextMessage(json));
        } catch (IOException | IllegalStateException e) {
            log.debug("dropping frame '{}' for session {}: {}", event, session.getId(), e.toString());
        } catch(SessionLimitExceededException e){
            log.debug("slow client {} exceeded session limit: {}", session.getId(), e.toString());
        }catch (Exception e) {
            log.warn("could not serialise frame '{}'", event, e);
        }
    }

    /** The substitute for an HTTP status code once the connection is upgraded. */
    public void sendError(WebSocketSession session, String code, String message) {
        send(session, WsEvents.ERROR, Map.of("code", code, "message", message));
    }
}
