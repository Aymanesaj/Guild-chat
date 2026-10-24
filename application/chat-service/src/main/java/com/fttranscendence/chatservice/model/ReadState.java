package com.fttranscendence.chatservice.model;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

/**
 * How far one user has read one room: every message up to last_read_id.
 * One document per (user, room), created on the first read.
 *
 * last_read_id is stored as an ObjectId, like message ids, so "newer than the
 * mark" is a plain _id comparison on the room history index.
 */
@Document(collection = ReadState.COLLECTION)
public record ReadState(
        @Id String id,
        @Field("user_id") String userId,
        @Field("room_id") Long roomId,
        @Field(name = "last_read_id", targetType = FieldType.OBJECT_ID) String lastReadId,
        @Field("updated_at") Instant updatedAt) {

    public static final String COLLECTION = "read_states";
}
