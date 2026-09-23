package com.fttranscendence.chatservice.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * One message, addressed by its own id: GET now, PATCH and DELETE next.
 * Separate from MessageController because that one is mapped under
 * /rooms/{roomId}/messages; here the room comes from the stored message,
 * never from the client.
 *
 * Reachable through the gateway at /api/chat/messages/{id}.
 */
@RestController
@RequestMapping("messages/{messageId}")

public class MessageItemController {
    public final MessageService messageService;

    public MessageItemController(MessageService messageService) {
        this.messageService = messageService;
    }
    @GetMapping
    public MessageResponse get(
        @PathVariable String messageId,
        @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId){
            return MessageResponse.from(messageService.get(userId , messageId));

        }
}
