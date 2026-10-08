package com.fttranscendence.chatservice.controller;



import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * GET /rooms/last-messages?ids=3,7,12
 *   → { "3": {message}, "7": null, "12": {message} }
 *
 * One request for every conversation preview, instead of one
 * GET /rooms/{id}/messages?limit=1 per room. Reachable through the gateway
 * at /api/chat/rooms/last-messages.
 *
 * No clash with /rooms/{roomId}/messages: that path has one more segment.
 */
@RestController
public class LastMessageController {
    private final MessageService messageService;

    public LastMessageController(MessageService messageService) {
        this.messageService = messageService;
    }

    @GetMapping("/rooms/last-messages")
    public Map<Long , MessageResponse> lastMessages(
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @RequestParam(name = "ids", required = false) List<Long> roomIds) {
                Map<Long , MessageResponse> body = new LinkedHashMap<>();
                messageService.latestMessages(userId, roomIds)
                .forEach((roomId, message) -> body.put(roomId,  message == null ? null : MessageResponse.from(message)));
                return body ;
            }
}
