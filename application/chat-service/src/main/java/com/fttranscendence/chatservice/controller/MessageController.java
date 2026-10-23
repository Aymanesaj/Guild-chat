
package com.fttranscendence.chatservice.controller;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.MessageResponse;
import com.fttranscendence.chatservice.dto.SendMessageRequest;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.AttachmentUrls;
import com.fttranscendence.chatservice.service.MessageService;

import jakarta.validation.Valid;

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
    private final AttachmentUrls attachmentUrls;

    public MessageController(MessageService messageService , AttachmentUrls attachmentUrls) {
        this.messageService = messageService;
        this.attachmentUrls = attachmentUrls;
    }

    @GetMapping
    public List<MessageResponse> history(
            @PathVariable Long roomId,
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @RequestParam(required = false) String before,
            @RequestParam(required = false) Integer limit) {

        return messageService.history(userId ,roomId, before, limit)
                .stream()
                .map(message -> MessageResponse.from(message, attachmentUrls::sign))
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MessageResponse send(
        @PathVariable Long roomId ,
        @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
        @Valid @RequestBody SendMessageRequest request)
        {
            // Send the message and return the response
            Message message = messageService.send(userId  , roomId , request.content() ,request.replyToId(), request.attachmentUploadIds());

            return MessageResponse.from(message, attachmentUrls::sign);
        }
}
