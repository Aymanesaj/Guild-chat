
package com.fttranscendence.chatservice.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * Service for managing messages in a chat room.
 * Reachable through the gateway at /api/chat/rooms/{id}/messages
 * (the /api/chat/ location strips the prefix before proxying).
 *
 */
@RestController
@RequestMapping("/rooms/{roomId}/messages")
public class MessageController {

    private final MessageService messageService;

    public MessageController(MessageService messageService) {
        this.messageService = messageService;
    }

    @GetMapping
    public List<MessageResponse> history(
            @PathVariable Long roomId,
            @RequestParam(required = false) String before,
            @RequestParam(required = false) Integer limit) {

        return messageService.history(roomId, before, limit)
                .stream()
                .map(MessageResponse::from) // short hand .map(message -> MessageResponse.from(message))
                .toList();
    }
}
