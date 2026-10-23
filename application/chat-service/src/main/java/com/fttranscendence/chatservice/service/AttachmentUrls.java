package com.fttranscendence.chatservice.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.dto.AttachmentResponse;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.model.Attachment;

/**
 * Signed read URLs for message images, remembered while they are still valid.
 *
 * A history page can hold up to 200 images; asking media for each one on
 * every load would be 200 gRPC calls. A URL is reused while it has at least
 * MIN_REMAINING left, so a client always gets time to load it.
 *
 * In memory only, never in Mongo: the URLs expire. Callers must have checked
 * that the user is a member of the message's room.
 *
 * Best effort: an image media cannot sign comes back with url null, and the
 * rest of the response is unaffected.
 */
@Component
public class AttachmentUrls {

    private static final Logger log = LoggerFactory.getLogger(AttachmentUrls.class);

    static final Duration MIN_REMAINING = Duration.ofSeconds(60);
    /** After media is unavailable, stop asking briefly: one page has many images. */
    static final Duration PAUSE_AFTER_FAILURE = Duration.ofSeconds(5);
    static final int MAX_ENTRIES = 10_000;

    private record Signed(String url, Instant expiresAt) {}

    private final MediaClient mediaClient;
    private final Clock clock;
    private final Map<String, Signed> byMediaId = new ConcurrentHashMap<>();
    private volatile Instant pausedUntil = Instant.MIN;

    public AttachmentUrls(MediaClient mediaClient, Clock clock) {
        this.mediaClient = mediaClient;
        this.clock = clock;
    }

    public AttachmentResponse sign(Attachment attachment) {
        Instant now = clock.instant();
        Signed cached = byMediaId.get(attachment.mediaId());
        if (cached != null && cached.expiresAt().isAfter(now.plus(MIN_REMAINING))) {
            return AttachmentResponse.from(attachment, cached.url(), cached.expiresAt());
        }
        if (now.isBefore(pausedUntil)) {
            return AttachmentResponse.from(attachment);
        }
        try {
            MediaClient.SignedUrl signed = mediaClient.downloadUrl(attachment.mediaId(), attachment.ownerId());
            Signed fresh = new Signed(signed.url(), now.plusSeconds(signed.expiresIn()));
            remember(attachment.mediaId(), fresh, now);
            return AttachmentResponse.from(attachment, fresh.url(), fresh.expiresAt());
        } catch (ApiException e) {
            if (e.getStatus() == HttpStatus.SERVICE_UNAVAILABLE) {
                pausedUntil = now.plus(PAUSE_AFTER_FAILURE);
            }
            log.debug("no URL for media {}: {}", attachment.mediaId(), e.getCode());
            return AttachmentResponse.from(attachment);
        }
    }

    /** Drops a deleted image's URL (used by step 5). */
    public void forget(String mediaId) {
        byMediaId.remove(mediaId);
    }

    private void remember(String mediaId, Signed signed, Instant now) {
        if (byMediaId.size() >= MAX_ENTRIES) {
            byMediaId.values().removeIf(s -> !s.expiresAt().isAfter(now.plus(MIN_REMAINING)));
            if (byMediaId.size() >= MAX_ENTRIES) {
                byMediaId.clear();
            }
        }
        byMediaId.put(mediaId, signed);
    }
}
