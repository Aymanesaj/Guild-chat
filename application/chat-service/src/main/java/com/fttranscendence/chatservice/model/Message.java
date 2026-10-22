package com.fttranscendence.chatservice.model;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

@Document(collection = "messages")
public class Message {

    @Id
    private String id;

    @Field("room_id")
    private Long roomId;

    @Field("sender_id")
    private String senderId;

    @Field("reply_to_id")
    private String replyToId;

    @Field("content")
    private String content;

    @Field("content_type")
    private String contentType;

    @Field("created_at")
    private Instant createdAt;

    @Field("edited_at")
    private Instant editedAt;

    @Field("deleted_at")
    private Instant deletedAt;


    /** Set only on system messages: what happened in the room. */
    @Field("system")
    private SystemEvent system;

    @Field("event_id")
    private String eventId;

    /**
     * Required by Spring Data to reconstruct the document from MongoDB.
     */
    protected Message() {
    }

    private Message(
            Long roomId,
            String senderId,
            String replyToId,
            String content,
            String contentType,
            Instant createdAt) {

        this.roomId = roomId;
        this.senderId = senderId;
        this.replyToId = replyToId;
        this.content = content;
        this.contentType = contentType;
        this.createdAt = createdAt;
    }

    /**
     * Creates a new message.
     *
     * senderId must come from the authenticated user,
     * never from client-provided data.
     */
    public static Message create(
            Long roomId,
            String senderId,
            String replyToId,
            String content,
            String contentType,
            Instant createdAt) {

        return new Message(
                roomId,
                senderId,
                replyToId,
                content,
                contentType,
                createdAt);
    }

    public static final String SYSTEM_CONTENT_TYPE = "system";

    /**
     * A room event shown in the history. No sender and no content: the
     * frontend renders the sentence from the SystemEvent.
     */

    public static Message system(Long roomId , String eventId,  SystemEvent system , Instant createdAt){
        Message message = new Message(roomId, null, null, null, SYSTEM_CONTENT_TYPE, createdAt);
        message.eventId = eventId;
        message.system = system;
        return message;
    }

    /** System messages cannot be edited, deleted or replied to. */
    public boolean isSystem() {
        return system != null ;
    }

    public SystemEvent getSystem() {
        return system;
    }

    public String getEventId() {
        return eventId;
    }
    /**
     * Applies an edit to the message.
     * Ownership and the edit time window are checked by the service layer.
     */
    public void applyEdit(String newContent, Instant editedAt) {
        this.content = newContent;
        this.editedAt = editedAt;
    }

    /**
     * Soft-deletes the message.
     * The document remains in MongoDB.
     */
    public void markDeleted(Instant deletedAt) {
        this.deletedAt = deletedAt;
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public String getId() {
        return id;
    }

    public Long getRoomId() {
        return roomId;
    }

    public String getSenderId() {
        return senderId;
    }

    public String getReplyToId() {
        return replyToId;
    }

    public String getContent() {
        return content;
    }

    public String getContentType() {
        return contentType;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getEditedAt() {
        return editedAt;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }
}
