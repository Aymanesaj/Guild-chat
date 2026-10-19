package com.fttranscendence.chatservice.messaging;



import java.util.List;

public record RoomChangedMessage(
        String roomId,
        String change ,
        List<String> userIds,
        boolean roomDeleted
) {
}
