package com.fttranscendence.chatservice.service;

import java.util.List;

import org.bson.types.ObjectId;
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

    public MessageService(MessageRepository messageRepository, OrgClient orgClient) {
        this.messageRepository = messageRepository;
        this.orgClient = orgClient;
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
