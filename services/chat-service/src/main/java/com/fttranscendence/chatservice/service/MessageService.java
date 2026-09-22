package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.util.List;

import org.bson.types.ObjectId;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;

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
}
