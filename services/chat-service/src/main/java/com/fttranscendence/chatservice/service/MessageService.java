package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.bson.types.ObjectId;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;

import com.fttranscendence.chatservice.grpc.Membership;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.repository.MessageRepository;

/**
 * The rules live here, not in the controller, because the WebSocket handler
 * must reach exactly the same logic without going through Spring MVC.
*/

@Service
public class MessageService {

    static final int DEFAULT_LIMIT = 50;
    static final int MAX_LIMIT = 100;

    private final MessageRepository messageRepository;
    private final OrgClient orgClient;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public MessageService(MessageRepository messageRepository, OrgClient orgClient, Clock clock , ApplicationEventPublisher events) {
        this.messageRepository = messageRepository;
        this.orgClient = orgClient;
        this.clock = clock;
        this.events = events;
    }


    private static final String DEFAULT_CONTENT_TYPE = "text";
    /**
     * Stores a message. The sender is the authenticated caller, never a value
     * taken from the request body.
     */

    public Message send(String userId, Long roomId, String content,  String replyToId) {
        if (!orgClient.isMember(userId, roomId)){
            throw ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room");
        }

        String reply = resolveReplyToId(roomId, replyToId);

        Message message =  Message.create( roomId , userId ,  reply , content ,DEFAULT_CONTENT_TYPE , clock.instant());
        Message saved = messageRepository.save(message);
        events.publishEvent(new MessageCreatedEvent(saved));
        return saved ;
    }

    /**
     * A reply must point at a live message in the SAME room. MongoDB enforces
     * no such thing, so without this check a reply could quote a message from
     * a room the sender cannot read.
     */

    private String resolveReplyToId(Long roomId, String replyToId) {
        if (replyToId == null ||  replyToId.isBlank()) {
            return null;
        }

        if(!ObjectId.isValid(replyToId)){
            throw ApiException.badRequest("INVALID_REPLY_ID", "'reply_to_id' is not a valid message id");
        }

        Message target = messageRepository.findById(replyToId)
        .orElseThrow(() -> ApiException.badRequest("REPLY_NOT_FOUND", "Replied-to message does not exist"));

        if (!target.getRoomId().equals(roomId)) {
            throw ApiException.badRequest("REPLY_WRONG_ROOM","Replied-to message belongs to a different room");
        }

        if (target.isDeleted()) {
            throw ApiException.badRequest("REPLY_DELETED", "Replied-to message has been deleted");
        }

        return replyToId;
    }

    /**
     * Cursor-paginated history, newest first.
     *
     * @param before message id to read strictly before, or null for the newest page
     * @param limit  page size, or null for the default
     */
    public List<Message> history(String userId, Long roomId, String before, Integer limit) {
        // NEW: membership first — before validation, so error codes cannot be
        // used to probe rooms the caller has no access to.
        if(!orgClient.isMember(userId, roomId)) {
            throw ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room");
        }
        Limit pageSize = Limit.of(validateLimit(limit));

        if (before == null || before.isBlank()) {
            return messageRepository.findByRoomIdOrderByIdDesc(roomId, pageSize);
        }

        if (!ObjectId.isValid(before)) {
            throw ApiException.badRequest("INVALID_CURSOR", "'before' is not a valid message id");
        }

        return messageRepository.findByRoomIdAndIdLessThanOrderByIdDesc(roomId, before, pageSize);
    }

    private int validateLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw ApiException.badRequest("INVALID_LIMIT", "'limit' must be between 1 and " + MAX_LIMIT);
        }
        return limit;
    }

    /**
     *
     * One message by id. Deleted messages are returned too
     * (DTO hides  their content). the same as history
     */

    public Message get(String userId,   String messageId) {
        return loadVisible(userId,  messageId);
    }

    /**
    /* Shared by GET, PATCH and DELETE on /messages/:id.
    /*
    /* A non-member gets the SAME 404 as an unknown id: a 403 would confirm
    /* that the message exists in a room they cannot read. The room id is not
    /* in the URL here, so unlike history there is nothing public to protect.
    /*/

    /** 400 for a malformed id, 404 for an unknown one. No membership check. */
    private Message findMessage(String messageId){
        if (!ObjectId.isValid(messageId)){
            throw ApiException.badRequest("INVALID_MESSAGE_ID", "'id' is not a valid message id");
        }
        return messageRepository.findById(messageId)
        .orElseThrow(() -> ApiException.notFound("MESSAGE_NOT_FOUND" , "Message does not exist"));
    }

    /**
     * A non-member gets the SAME 404 as an unknown id: a 403 would confirm
     * that the message exists in a room they cannot read.
     */
    private Message loadVisible(String userId,  String messageId) {
        Message message = findMessage(messageId); 
        if(!orgClient.isMember(userId, message.getRoomId())) {
            throw ApiException.notFound("MESSAGE_NOT_FOUND", "Message does not exist");
        }

        return message;
    }

    static final Duration EDIT_WINDOW = Duration.ofMinutes(15);
    /**
     * Edits a message: sender only, not deleted, and strictly within 15 minutes
     * of sending. At exactly 15:00 the edit is refused (spec: now < created_at + 15 min).
     */
    public Message edit(String userId , String messageId, String content){
        Message message = loadVisible(userId, messageId);

        if(!message.getSenderId().equals(userId)){
            throw ApiException.forbidden("NOT_SENDER", "Only the sender can edit this message");
        }
        if (message.isDeleted()) {
            throw ApiException.forbidden("MESSAGE_DELETED", "Cannot edit a deleted message");
        }
        Instant now = clock.instant();
        if (!now.isBefore(message.getCreatedAt().plus(EDIT_WINDOW))) {
            throw ApiException.forbidden("EDIT_WINDOW_EXPIRED", "Edit window has expired");
        }

        // Atomic: if a delete landed after we loaded the message, nothing is
        // written. A whole-document save() here would put deleted_at back to null.
        if (messageRepository.applyEditIfLive(messageId, content, now) == 0) {
            throw ApiException.forbidden("MESSAGE_DELETED", "Cannot edit a deleted message");
        }

        message.applyEdit(content , now );
        events.publishEvent(new MessageEditedEvent(message));
        return message;

    }

    /**
     * Soft delete: the sender, or a room OWNER/ADMIN. Deleting twice is not an
     * error (204 both times), but only the first delete is broadcast.
     * Permission is checked BEFORE "already deleted", so a plain member gets
     * 403 on someone else's message whether or not it is deleted.
     */
    public  void delete(String userId , String messageId){
        Message message = findMessage(messageId);
        Membership membership = orgClient.membership(userId, message.getRoomId());

        if(!membership.member()) {
            throw ApiException.notFound("MESSAGE_NOT_FOUND" ,"message does not exist");
        }

        boolean own = message.getSenderId().equals(userId);
        if (!own &&  !membership.canModerate()){
            throw ApiException.forbidden("NOT_ALLOWED", "Only the sender or a room admin can delete this message");
        }
        Instant now = clock.instant();
              if (messageRepository.markDeletedIfLive(messageId, now) == 0) {
            return; // already deleted (maybe a moment ago by someone else): nothing new to announce
        }
        message.markDeleted(now);
        events.publishEvent(new MessageDeletedEvent(message));
    }
}
