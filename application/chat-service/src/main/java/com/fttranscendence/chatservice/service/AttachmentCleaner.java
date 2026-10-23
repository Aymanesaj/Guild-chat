package com.fttranscendence.chatservice.service;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.MediaClient;
import com.fttranscendence.chatservice.model.Attachment;

import jakarta.annotation.PreDestroy;

/**
 * Deletes the images of deleted messages and rooms in media-service.
 *
 * Off the request thread: a delete must not wait on media, or fail because
 * of it. Best effort: an image media cannot delete stays in storage and is
 * logged; the message is deleted either way.
 */
@Component
public class AttachmentCleaner {

    private static final Logger log = LoggerFactory.getLogger(AttachmentCleaner.class);

    private final MediaClient mediaClient;
    private final AttachmentUrls attachmentUrls;
    private final Executor executor;
    /** The executor this class created and must shut down; null when a test supplied one. */
    private final ExecutorService ownedExecutor;

    @Autowired
    public AttachmentCleaner(MediaClient mediaClient, AttachmentUrls attachmentUrls) {
        this(mediaClient, attachmentUrls, Executors.newVirtualThreadPerTaskExecutor());
    }

    /** For tests: pass Runnable::run to make deletion synchronous. */
    AttachmentCleaner(MediaClient mediaClient, AttachmentUrls attachmentUrls, Executor executor) {
        this.mediaClient = mediaClient;
        this.attachmentUrls = attachmentUrls;
        this.executor = executor;
        this.ownedExecutor = executor instanceof ExecutorService service ? service : null;
    }

    @EventListener
    public void onDeleted(MessageDeletedEvent event) {
        deleteAll(event.message().getAttachments());
    }

    public void deleteAll(List<Attachment> attachments) {
        if (attachments.isEmpty()) {
            return;
        }
        List<Attachment> images = List.copyOf(attachments);
        // Right away, not in the task: a deleted image must never be served again.
        images.forEach(image -> attachmentUrls.forget(image.mediaId()));
        executor.execute(() -> images.forEach(this::deleteOne));
    }

    private void deleteOne(Attachment image) {
        try {
            mediaClient.delete(image.mediaId(), image.ownerId());
        } catch (ApiException e) {
            log.warn("media {} not deleted ({}): left in storage", image.mediaId(), e.getCode());
        }
    }

    @PreDestroy
    void shutdown() {
        if (ownedExecutor != null) {
            ownedExecutor.shutdown();
        }
    }
}
