package com.fttranscendence.chatservice.grpc;

import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.media.grpc.CreateUploadRequest;
import com.fttranscendence.media.grpc.CreateUploadResponse;
import com.fttranscendence.media.grpc.FinalizeUploadResponse;
import com.fttranscendence.media.grpc.GetDownloadUrlResponse;
import com.fttranscendence.media.grpc.MediaPurpose;
import com.fttranscendence.media.grpc.MediaRequest;
import com.fttranscendence.media.grpc.MediaServiceGrpc;
import com.fttranscendence.media.grpc.UploadRequest;
import com.fttranscendence.media.grpc.UploadStatus;

import io.grpc.Channel;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import jakarta.annotation.PreDestroy;

/**
 * Talks to media-service for chat images (purpose CHAT_IMAGE).
 *
 * Media knows owners, not rooms: the owner is always the uploader, and room
 * membership is checked by chat before any call. Every call carries chat's
 * service token; without one, image features answer 503 instead of failing
 * chat's startup.
 */
@Component
public class MediaClient {

    private static final Logger log = LoggerFactory.getLogger(MediaClient.class);

    static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    /** What the browser needs to PUT the file straight to R2. */
    public record UploadTicket(String uploadId, String uploadUrl, String contentType, int expiresIn) {}

    /** A processed image, ready to attach to a message. */
    public record FinalizedImage(String mediaId, String contentType, int width, int height) {}

    /** A short-lived signed URL for reading an image. */
    public record SignedUrl(String url, int expiresIn) {}

    private final ManagedChannel ownedChannel;
    private final MediaServiceGrpc.MediaServiceBlockingStub stub;
    private final boolean configured;
    private final long deadlineMs;
    private final long finalizeDeadlineMs;

    @Autowired
    public MediaClient(
            @Value("${chat.grpc.media.host}") String host,
            @Value("${chat.grpc.media.port}") int port,
            @Value("${chat.media.token}") String token,
            @Value("${chat.grpc.media.deadline-ms}") long deadlineMs,
            @Value("${chat.grpc.media.finalize-deadline-ms}") long finalizeDeadlineMs) {
        // Plaintext: this traffic never leaves the private Docker network.
        this(ManagedChannelBuilder.forAddress(host, port).usePlaintext().build(),
                token, deadlineMs, finalizeDeadlineMs);
        if (!configured) {
            log.warn("MEDIA_CHAT_TOKEN is not set: chat image endpoints will answer 503");
        }
    }

    /** For tests: an in-process channel. A ManagedChannel passed here is shut down with the client. */
    MediaClient(Channel channel, String token, long deadlineMs, long finalizeDeadlineMs) {
        this.ownedChannel = channel instanceof ManagedChannel managed ? managed : null;
        this.configured = token != null && !token.isBlank();
        Metadata headers = new Metadata();
        // Never sent when unconfigured: call() refuses before reaching the network.
        headers.put(AUTHORIZATION, "Bearer " + (configured ? token.trim() : ""));
        this.stub = MediaServiceGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
        this.deadlineMs = deadlineMs;
        this.finalizeDeadlineMs = finalizeDeadlineMs;
    }

    /** Reserves an upload slot; the browser then PUTs the file to the returned URL. */
    public UploadTicket createUpload(String ownerId, String contentType) {
        CreateUploadResponse response = call("CreateUpload", () -> stub
                .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
                .createUpload(CreateUploadRequest.newBuilder()
                        .setOwnerId(ownerId)
                        .setPurpose(MediaPurpose.CHAT_IMAGE)
                        .setContentType(contentType)
                        .build()));
        return new UploadTicket(response.getUploadId(), response.getUploadUrl(),
                response.getRequiredContentType(), response.getExpiresIn());
    }

    /**
     * Validates and processes the uploaded file (real type, size, resize, WebP).
     * Safe to call again for an upload that is already READY.
     */
    public FinalizedImage finalizeUpload(String uploadId, String ownerId) {
        FinalizeUploadResponse response = call("FinalizeUpload", () -> stub
                .withDeadlineAfter(finalizeDeadlineMs, TimeUnit.MILLISECONDS)
                .finalizeUpload(UploadRequest.newBuilder()
                        .setUploadId(uploadId)
                        .setOwnerId(ownerId)
                        .setPurpose(MediaPurpose.CHAT_IMAGE)
                        .build()));
        if (response.getStatus() != UploadStatus.READY) {
            throw new ApiException(HttpStatus.CONFLICT, "ATTACHMENT_NOT_READY",
                    "Image is still being processed, retry");
        }
        return new FinalizedImage(response.getMediaId(), response.getContentType(),
                response.getWidth(), response.getHeight());
    }

    /** A signed read URL. Chat checks room membership before asking. */
    public SignedUrl downloadUrl(String mediaId, String ownerId) {
        GetDownloadUrlResponse response = call("GetDownloadUrl", () -> stub
                .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
                .getDownloadUrl(media(mediaId, ownerId)));
        return new SignedUrl(response.getDownloadUrl(), response.getExpiresIn());
    }

    public void delete(String mediaId, String ownerId) {
        call("DeleteMedia", () -> stub
                .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
                .deleteMedia(media(mediaId, ownerId)));
    }

    private static MediaRequest media(String mediaId, String ownerId) {
        return MediaRequest.newBuilder()
                .setMediaId(mediaId)
                .setOwnerId(ownerId)
                .setPurpose(MediaPurpose.CHAT_IMAGE)
                .build();
    }

    private <T> T call(String rpc, Supplier<T> request) {
        if (!configured) {
            throw unavailable();
        }
        try {
            return request.get();
        } catch (StatusRuntimeException e) {
            throw translate(rpc, e);
        }
    }

    /** Media's gRPC status → the API error the browser sees. */
    private static ApiException translate(String rpc, StatusRuntimeException e) {
        Status.Code code = e.getStatus().getCode();
        return switch (code) {
            // Unknown upload/media, or another owner's: the same answer, so ids cannot be probed.
            case NOT_FOUND -> ApiException.notFound("ATTACHMENT_NOT_FOUND", "Image not found");
            // Media's message is safe and useful here: wrong type, animated, too large...
            case INVALID_ARGUMENT -> ApiException.badRequest("INVALID_IMAGE",
                    e.getStatus().getDescription() == null ? "Invalid image" : e.getStatus().getDescription());
            case FAILED_PRECONDITION -> new ApiException(HttpStatus.CONFLICT, "ATTACHMENT_UNAVAILABLE",
                    "Image upload expired or failed, upload it again");
            case ABORTED, RESOURCE_EXHAUSTED -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "MEDIA_BUSY", "Image service is busy, retry");
            default -> {
                // UNAUTHENTICATED / PERMISSION_DENIED mean our own config is wrong: log loudly.
                log.warn("media-service {} failed: {}", rpc, code, e);
                yield unavailable();
            }
        };
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE",
                "Image service is unavailable");
    }

    @PreDestroy
    void shutdown() {
        if (ownedChannel != null) {
            ownedChannel.shutdown();
        }
    }
}
