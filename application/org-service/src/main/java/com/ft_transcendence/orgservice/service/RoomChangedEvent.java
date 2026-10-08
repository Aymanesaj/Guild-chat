package com.ft_transcendence.orgservice.service;

import java.util.Set;
import java.util.UUID;

import com.fttranscendence.chat.grpc.RoomChange;

/**
 * A room changed in a way some users' room lists must reflect.
 *
 * Published by RoomService inside its transaction; ChatNotifyClient forwards
 * it to chat-service only once that transaction has committed, so a client
 * that refetches on the notification always reads the new state.
 *
 * @param roomId  the room that changed
 * @param change  ADDED / REMOVED / UPDATED, from the users' point of view
 * @param userIds who to tell; never empty (RoomService skips empty events)
 */
public record RoomChangedEvent(Long roomId, RoomChange change, Set<UUID> userIds) {
}
