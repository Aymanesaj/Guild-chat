package com.fttranscendence.chatservice.model;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

/**
 * Something that happened to a user, kept for their notification list.
 * Messages are not here: unread counts cover them (ReadState).
 *
 * Ids only, no names: names change, and the client resolves them when it
 * renders, as for messages. source_id is what caused it (identity's event id,
 * or the system message's id), unique per user so a redelivered event cannot
 * notify twice.
 */
@Document(collection = Notification.COLLECTION)
public record Notification(
        @Id String id,
        @Field("user_id") String userId,
        @Field("type") String type,
        @Field("actor_id") String actorId,
        @Field("room_id") Long roomId,
        @Field("role") String role,
        @Field("friendship_id") String friendshipId,
        @Field("source_id") String sourceId,
        @Field("created_at") Instant createdAt,
        @Field("read_at") Instant readAt) {

    public static final String COLLECTION = "notifications";

    /** Someone sent you a friend request. actor: the requester. */
    public static final String FRIEND_REQUEST = "FRIEND_REQUEST";
    /** Someone accepted your friend request. actor: who accepted. */
    public static final String FRIEND_ACCEPTED = "FRIEND_ACCEPTED";
    /** Someone added you to a group room. */
    public static final String ROOM_ADDED = "ROOM_ADDED";
    /** Someone removed you from a group room. */
    public static final String ROOM_REMOVED = "ROOM_REMOVED";
    /** Your role in a room changed; role is the new one (OWNER when ownership was transferred to you). */
    public static final String ROLE_CHANGED = "ROLE_CHANGED";

    /** A new, unread notification. */
    public static Notification of(String userId, String type, String actorId, Long roomId, String role,
            String friendshipId, String sourceId, Instant createdAt) {
        return new Notification(null, userId, type, actorId, roomId, role, friendshipId, sourceId, createdAt, null);
    }
}
