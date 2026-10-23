package com.fttranscendence.chatservice.dto;

import java.time.Instant;

import com.fttranscendence.chatservice.model.Attachment;

/**
 * An image as the API shows it. owner_id stays internal.
 *
 * url is a short-lived signed link (see url_expires_at), null in previews or
 * when media could not sign it. When it expires, the client fetches the
 * message again (GET /messages/{id}) for a fresh one.
 */
public record AttachmentResponse(
        String mediaId,
        String contentType,
        int width,
        int height,
        String url,
        Instant urlExpiresAt) {

    /** Without a URL. */
    public static AttachmentResponse from(Attachment attachment) {
        return from(attachment, null, null);
    }

    public static AttachmentResponse from(Attachment attachment, String url, Instant urlExpiresAt) {
        return new AttachmentResponse(attachment.mediaId(), attachment.contentType(),
                attachment.width(), attachment.height(), url, urlExpiresAt);
    }
}
