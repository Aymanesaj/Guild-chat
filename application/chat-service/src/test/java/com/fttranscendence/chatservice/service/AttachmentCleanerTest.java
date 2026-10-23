package com.fttranscendence.chatservice.service;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.model.Message;

class AttachmentCleanerTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final Attachment FIRST = new Attachment("m1", ALICE, "image/webp", 10, 10);
    private static final Attachment SECOND = new Attachment("m2", BOB, "image/webp", 10, 10);

    private final MediaClient media = mock(MediaClient.class);
    private final AttachmentUrls urls = mock(AttachmentUrls.class);

    /** Runs the media calls on the calling thread. */
    private final AttachmentCleaner cleaner = new AttachmentCleaner(media, urls, Runnable::run);

    @Test
    @DisplayName("each image is deleted in media with its own uploader as owner, and its URL forgotten")
    void deletesEveryImage() {
        cleaner.deleteAll(List.of(FIRST, SECOND));

        verify(media).delete("m1", ALICE);
        verify(media).delete("m2", BOB);
        verify(urls).forget("m1");
        verify(urls).forget("m2");
    }

    @Test
    @DisplayName("a deleted message's images are cleaned through MessageDeletedEvent")
    void cleansOnMessageDeleted() {
        Message message = Message.create(42L, ALICE, null, null, "text",
                Instant.parse("2026-10-23T10:00:00Z"), List.of(FIRST));
        message.markDeleted(Instant.parse("2026-10-23T10:01:00Z"));

        cleaner.onDeleted(new MessageDeletedEvent(message));

        verify(media).delete("m1", ALICE);
    }

    @Test
    @DisplayName("a text message deletes nothing in media")
    void textMessageDeletesNothing() {
        cleaner.onDeleted(new MessageDeletedEvent(
                Message.create(42L, ALICE, null, "hi", "text", Instant.parse("2026-10-23T10:00:00Z"))));

        verifyNoInteractions(media, urls);
    }

    @Test
    @DisplayName("one image media refuses does not stop the others, and nothing is thrown")
    void failureIsContained() {
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE", "down"))
                .when(media).delete("m1", ALICE);

        cleaner.deleteAll(List.of(FIRST, SECOND));

        verify(media).delete("m2", BOB);
    }

    @Test
    @DisplayName("URLs are forgotten before media is called: a deleted image is never served while media is slow")
    void forgetsBeforeTheMediaCalls() {
        List<Runnable> queued = new ArrayList<>();
        AttachmentCleaner deferred = new AttachmentCleaner(media, urls, queued::add);

        deferred.deleteAll(List.of(FIRST));

        verify(urls).forget("m1");
        verifyNoInteractions(media);

        queued.forEach(Runnable::run);
        var order = inOrder(urls, media);
        order.verify(urls).forget("m1");
        order.verify(media).delete("m1", ALICE);
    }
}
