package com.fttranscendence.chatservice.model;

import org.springframework.data.mongodb.core.mapping.Field;

/** An image on a message. Only ids and size are stored; URLs are signed on each read. */
public record Attachment(
    @Field("media_id") String mediaId,
    @Field("owner_id") String ownerId,
    @Field("content_type") String contentType,
    @Field("width") int width,
    @Field("height") int height) {
}
