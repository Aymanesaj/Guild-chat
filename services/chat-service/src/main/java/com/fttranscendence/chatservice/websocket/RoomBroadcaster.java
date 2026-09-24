package com.fttranscendence.chatservice.websocket;


import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageCreatedEvent;
import com.fttranscendence.chatservice.service.MessageEditedEvent;
import com.fttranscendence.chatservice.service.MessageDeletedEvent;

/**
 * Pushes stored messages to every socket subscribed to their room.
 *
 * Runs synchronously in the thread that saved the message (the POST request).
 * Safe because FrameSender never throws: one dead socket cannot fail the POST
 * or stop delivery to the others. The registry holds the write-serialising
 * decorators, so two POSTs to one room at once cannot interleave frames.
 *
 * The sender's own sockets receive it too: their other tabs need it, and the
 * client dedupes the tab that sent it by message id.
 */

@Component
public class RoomBroadcaster {
    private static final Logger log = LoggerFactory.getLogger(RoomBroadcaster.class);

    private final SubscriptionRegistry subscriptionRegistry;
    private final FrameSender frameSender;


    public RoomBroadcaster(SubscriptionRegistry subscriptionRegistry , FrameSender frameSender) {
        this.subscriptionRegistry = subscriptionRegistry;
        this.frameSender = frameSender;
    }

    /** Same DTO as the REST response, so a message looks identical on both. */
    @EventListener
    public void onCreated(MessageCreatedEvent event) {
        Message message = event.message();
        broadcast(message.getRoomId()  ,WsEvents.MESSAGE_NEW, MessageResponse.from(message));
    }

    private void broadcast(Long roomId, String event,Object data) {
        Set<WebSocketSession> sessions  = subscriptionRegistry.sessionsIn(roomId);
        sessions.forEach(session -> frameSender.send(session, event, data));
        log.debug("{} room={} recipients={}", event, roomId, sessions.size());
    }


    @EventListener
    public void onEdited(MessageEditedEvent event) {
        Message message = event.message();
        broadcast(message.getRoomId(), WsEvents.MESSAGE_EDITED, MessageResponse.from(message));
    }

    @EventListener
    public void onDelete(MessageDeletedEvent event){
        Message message = event.message();
        broadcast(message.getRoomId() , WsEvents.MESSAGE_DELETED , MessageResponse.from(message));
    }
}
