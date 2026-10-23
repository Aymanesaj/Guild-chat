package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.bson.types.ObjectId;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.Membership;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.repository.MessageRepository;

/**
 * The rules live here, not in the controller, because the WebSocket handler
 * must reach exactly the same logic without going through Spring MVC.
*/

@Service
public class MessageService {

    static final int DEFAULT_LIMIT = 50;
    static final int MAX_LIMIT = 100;
    static final int MAX_PREVIEW_ROOMS = 100;

    private final MessageRepository messageRepository;
    private final OrgClient orgClient;
    private final Clock clock;
    private final ApplicationEventPublisher events;
    private final AttachmentService attachmentService;

    public MessageService(MessageRepository messageRepository, OrgClient orgClient, Clock clock , ApplicationEventPublisher events , AttachmentService attachmentService) {
        this.messageRepository = messageRepository;
        this.orgClient = orgClient;
        this.clock = clock;
        this.events = events;
        this.attachmentService = attachmentService;
    }


    private static final String DEFAULT_CONTENT_TYPE = "text";
    /** Text only. */
    public Message send(String userId, Long roomId, String content, String replyToId) {
        return send(userId, roomId, content, replyToId, List.of());
    }

    public Message send(String userId, Long roomId, String content, String replyToId, List<String> uploadIds) {
        if (!orgClient.isMember(userId, roomId)) {
            throw ApiException.forbidden("NOT_A_MEMBER", "User is not a member of the room");
        }
        List<String> uploads = uploadIds == null ? List.of() : uploadIds;
        String text = content == null || content.isBlank() ? null : content;
        if (text == null && uploads.isEmpty()) {
            throw ApiException.badRequest("EMPTY_MESSAGE", "A message needs text or an image");
        }

        String reply = resolveReplyToId(roomId, replyToId);
        // After every cheap check: finalizing is the slow part (download, resize, upload).
        List<Attachment> attachments = attachmentService.finalizeAll(userId, uploads);

        Message message = Message.create(roomId, userId, reply, text, DEFAULT_CONTENT_TYPE,
                clock.instant(), attachments);
        Message saved = messageRepository.save(message);
        events.publishEvent(new MessageCreatedEvent(saved));
        return saved;
    }

    /**
     * Stores a room event from org (member joined, kicked, ...) as a system
     * message, then announces it exactly like a sent message: message.new to
     * sockets with the room open, room.activity to every member.
     *
     * Stored before it is sent, so a reload shows exactly what was pushed.
     *
     * @return false if this event was already stored (a broker redelivery):
     *         it is not stored or announced a second time
     */
    public boolean recordSystemEvent(Long roomId, String eventId, SystemEvent system, Instant occurredAt) {
        Message saved;
        try {
            // insert, not save: a duplicate event_id must fail on the unique index.
            saved = messageRepository.insert(Message.system(roomId, eventId, system, occurredAt));
        } catch (DuplicateKeyException e) {
            return false;
        }
        events.publishEvent(new MessageCreatedEvent(saved));
        return true;
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

        if (target.isSystem()) {
            throw ApiException.badRequest("REPLY_SYSTEM", "Cannot reply to a system message");
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

    /**
     * Newest message of each requested room, for conversation previews.
     *
     * Rooms the caller is not a member of are left out entirely: not an
     * error, so the answer cannot be used to probe which rooms exist.
     * A room the caller is in but with no messages yet maps to null.
     */

    public Map<Long, Message> latestMessages(String userId, List<Long> roomIds) {
        List<Long> wanted = roomIds == null ? List.of() : roomIds.stream().distinct().toList();


        if (wanted.isEmpty()) {
            throw ApiException.badRequest("MISSING_IDS", "'ids' must list at least one room id");
        }
        if (wanted.size() > MAX_PREVIEW_ROOMS) {
            throw ApiException.badRequest("TOO_MANY_IDS", "'ids' must list at most " + MAX_PREVIEW_ROOMS + " room ids");
        }


        List<Long> allowed = wanted.stream()
        .filter( roomId -> orgClient.isMember(userId , roomId))
        .toList();
        Map<Long, Message> latest = new LinkedHashMap<>();

        allowed.forEach(roomId -> latest.put(roomId , null));


        if(!allowed.isEmpty()) {
            messageRepository.findLatestMessagesByRoomIds(allowed)
            .forEach(message -> latest.put(message.getRoomId() , message));
        }

        return latest ;
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

        // Checked first: a system message has no sender to compare with.
        if (message.isSystem()) {
            throw ApiException.forbidden("SYSTEM_MESSAGE", "Cannot edit a system message");
        }
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

        // After the membership check (non-members still get 404), before the sender check.
        if (message.isSystem()) {
            throw ApiException.forbidden("SYSTEM_MESSAGE", "System messages cannot be deleted");
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
