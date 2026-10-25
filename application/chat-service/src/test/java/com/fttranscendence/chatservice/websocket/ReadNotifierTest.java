package com.fttranscendence.chatservice.websocket;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fttranscendence.chatservice.dto.ReadMarkResponse;
import com.fttranscendence.chatservice.service.ReadStateService;
import com.fttranscendence.chatservice.service.RoomReadEvent;

class ReadNotifierTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Test
    @DisplayName("a read goes to every socket of the reader as room.read")
    void sendsRoomReadToTheReader() {
        ChatWebSocketHandler sockets = mock(ChatWebSocketHandler.class);
        ReadStateService.ReadMark read = new ReadStateService.ReadMark(42L, "66f0c1a2b3c4d5e6f7a8b9c0", 0);

        new ReadNotifier(sockets).onRead(new RoomReadEvent(ALICE, read));

        verify(sockets).sendToUser(ALICE, "room.read", new ReadMarkResponse(42L, "66f0c1a2b3c4d5e6f7a8b9c0", 0));
    }
}
