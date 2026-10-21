package com.ft_transcendence.orgservice.service;

import java.util.Set;
import java.util.UUID;
import com.ft_transcendence.orgservice.messaging.RoomChange;

/** Internal transaction event. roomDeleted is explicit; a departure is not a deletion. */
public record RoomChangedEvent(Long roomId, RoomChange change, Set<UUID> userIds, boolean roomDeleted) {
    public RoomChangedEvent(Long roomId, RoomChange change, Set<UUID> userIds) {
        this(roomId, change, userIds, false);
    }
}
