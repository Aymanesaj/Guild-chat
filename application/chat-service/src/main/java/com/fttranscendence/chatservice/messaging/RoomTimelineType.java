package com.fttranscendence.chatservice.messaging;

/** Room timeline event names in org's public JSON contract (docs/room-timeline-events.md). */
public enum RoomTimelineType {
    ROOM_CREATED,
    MEMBER_JOINED,
    MEMBER_LEFT,
    MEMBER_KICKED,
    OWNERSHIP_TRANSFERRED,
    ROLE_CHANGED,
    ROOM_RENAMED
}
