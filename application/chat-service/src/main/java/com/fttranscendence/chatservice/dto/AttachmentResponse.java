package com.fttranscendence.chatservice.dto;

import com.fttranscendence.chatservice.model.Attachment;

/**
 * An image as the API shows it. owner_id stays internal. Step 4 adds
 * url / url_expires_at here.
 */
public record AttachmentResponse(String mediaId, String contentType, int width, int height) {

    public static AttachmentResponse from(Attachment attachment) {
        return new AttachmentResponse(attachment.mediaId(), attachment.contentType(),
                attachment.width(), attachment.height());
    }
}
