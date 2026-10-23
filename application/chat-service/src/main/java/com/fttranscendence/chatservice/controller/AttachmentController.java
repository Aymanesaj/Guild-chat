
package com.fttranscendence.chatservice.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.dto.UploadUrlRequest;
import com.fttranscendence.chatservice.dto.UploadUrlResponse;
import com.fttranscendence.chatservice.service.AttachmentService;

import jakarta.validation.Valid;

/**
 * Chat images. Reachable through the gateway at /api/chat/rooms/{id}/attachments/...
 */
@RestController
@RequestMapping("/rooms/{roomId}/attachments")
public class AttachmentController {

    private final AttachmentService attachmentService;

    public AttachmentController(AttachmentService attachmentService) {
        this.attachmentService = attachmentService;
    }

    @PostMapping("/upload-url")
    @ResponseStatus(HttpStatus.CREATED)
    public UploadUrlResponse uploadUrl(
            @PathVariable Long roomId,
            @RequestAttribute(AuthenticationFilter.USER_ID_ATTRIBUTE) String userId,
            @Valid @RequestBody UploadUrlRequest request) {
        return UploadUrlResponse.from(attachmentService.uploadUrl(userId, roomId, request.contentType()));
    }
}
