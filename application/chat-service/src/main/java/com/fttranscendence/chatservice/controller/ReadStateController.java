package com.fttranscendence.chatservice.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.ReadMarkResponse;
import com.fttranscendence.chatservice.dto.ReadRequest;
import com.fttranscendence.chatservice.service.ReadStateService;

import jakarta.validation.Valid;

/**
 * Read marks and unread counts, for badges in room and DM lists.
 *
 *   PUT /rooms/{roomId}/read   { "message_id": "..." } -> { room_id, last_read_id, unread }
 *   GET /rooms/unread?ids=3,7  -> { "3": 5, "7": 0 }
 *
 * Reachable through the gateway at /api/chat/rooms/... GET /rooms/unread does
 * not clash with /rooms/{roomId}/...: it has one segment fewer.
 */
@RestController
public class ReadStateController {

    private final ReadStateService readStateService;

    public ReadStateController(ReadStateService readStateService) {
        this.readStateService = readStateService;
    }

    @PutMapping("/rooms/{roomId}/read")
    public ReadMarkResponse markRead(
            @PathVariable Long roomId,
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @Valid @RequestBody ReadRequest request) {
        return ReadMarkResponse.from(readStateService.markRead(userId, roomId, request.messageId()));
    }

    @GetMapping("/rooms/unread")
    public Map<Long, Integer> unread(
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @RequestParam(name = "ids", required = false) List<Long> roomIds) {
        return readStateService.unreadCounts(userId, roomIds);
    }
}
