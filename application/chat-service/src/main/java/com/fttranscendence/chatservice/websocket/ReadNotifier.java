package com.fttranscendence.chatservice.websocket;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.dto.ReadMarkResponse;
import com.fttranscendence.chatservice.service.RoomReadEvent;

/**
 * room.read to every socket of the user who read: a room read in one tab
 * loses its badge in the others. The tab that read gets it too, and can
 * ignore it.
 */
@Component
public class ReadNotifier {

    private final ChatWebSocketHandler sockets;

    public ReadNotifier(ChatWebSocketHandler sockets) {
        this.sockets = sockets;
    }

    @EventListener
    public void onRead(RoomReadEvent event) {
        sockets.sendToUser(event.userId(), WsEvents.ROOM_READ, ReadMarkResponse.from(event.read()));
    }
}
