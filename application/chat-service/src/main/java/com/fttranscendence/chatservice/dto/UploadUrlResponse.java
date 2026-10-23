package com.fttranscendence.chatservice.dto;

import com.fttranscendence.chatservice.grpc.MediaClient;

/**
 * Where the browser PUTs the file. The PUT must send exactly this
 * Content-Type, and must happen before expires_in seconds run out.
 */
public record UploadUrlResponse(String uploadId, String uploadUrl, String contentType, int expiresIn) {

    public static UploadUrlResponse from(MediaClient.UploadTicket ticket) {
        return new UploadUrlResponse(ticket.uploadId(), ticket.uploadUrl(),
                ticket.contentType(), ticket.expiresIn());
    }
}
