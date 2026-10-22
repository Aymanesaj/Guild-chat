package com.fttranscendence.chatservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.media.grpc.CreateUploadRequest;
import com.fttranscendence.media.grpc.CreateUploadResponse;
import com.fttranscendence.media.grpc.DeleteMediaResponse;
import com.fttranscendence.media.grpc.FinalizeUploadResponse;
import com.fttranscendence.media.grpc.GetDownloadUrlResponse;
import com.fttranscendence.media.grpc.MediaPurpose;
import com.fttranscendence.media.grpc.MediaRequest;
import com.fttranscendence.media.grpc.MediaServiceGrpc;
import com.fttranscendence.media.grpc.UploadRequest;
import com.fttranscendence.media.grpc.UploadStatus;

import io.grpc.Context;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.ServerInterceptors;
import io.grpc.Status;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;

/**
 * Drives MediaClient against a fake media-service: what is sent (token,
 * purpose, owner, deadlines) and how every media answer becomes an API error.
 */
class MediaClientTest {

    private static final String TOKEN = "a".repeat(64);
    private static final String OWNER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    private Server server;
    private ManagedChannel channel;
    private final FakeMedia media = new FakeMedia();

    @AfterEach
    void tearDown() {
        if (channel != null) {
            channel.shutdownNow();
        }
        if (server != null) {
            server.shutdownNow();
        }
    }

    /** Records what chat sends; answers with a fixed reply, an error, or never. */
    static final class FakeMedia extends MediaServiceGrpc.MediaServiceImplBase {
        Status failWith;
        boolean hang;
        UploadStatus finalizeStatus = UploadStatus.READY;
        final List<Object> requests = new ArrayList<>();
        final List<String> authorizations = new ArrayList<>();
        final List<Long> deadlinesMs = new ArrayList<>();

        private <T> boolean answer(Object request, StreamObserver<T> observer) {
            requests.add(request);
            var deadline = Context.current().getDeadline();
            deadlinesMs.add(deadline == null ? -1 : deadline.timeRemaining(TimeUnit.MILLISECONDS));
            if (hang) {
                return false;
            }
            if (failWith != null) {
                observer.onError(failWith.asRuntimeException());
                return false;
            }
            return true;
        }

        @Override
        public void createUpload(CreateUploadRequest request, StreamObserver<CreateUploadResponse> observer) {
            if (answer(request, observer)) {
                observer.onNext(CreateUploadResponse.newBuilder()
                        .setUploadId("upload-1").setUploadUrl("https://r2.example/tmp/upload-1/source?sig=x")
                        .setRequiredContentType(request.getContentType()).setExpiresIn(300).build());
                observer.onCompleted();
            }
        }

        @Override
        public void finalizeUpload(UploadRequest request, StreamObserver<FinalizeUploadResponse> observer) {
            if (answer(request, observer)) {
                observer.onNext(FinalizeUploadResponse.newBuilder()
                        .setMediaId("media-1").setContentType("image/webp")
                        .setWidth(2048).setHeight(1365).setStatus(finalizeStatus).build());
                observer.onCompleted();
            }
        }

        @Override
        public void getDownloadUrl(MediaRequest request, StreamObserver<GetDownloadUrlResponse> observer) {
            if (answer(request, observer)) {
                observer.onNext(GetDownloadUrlResponse.newBuilder()
                        .setMediaId(request.getMediaId()).setDownloadUrl("https://r2.example/chat/media-1.webp?sig=y")
                        .setContentType("image/webp").setExpiresIn(300).build());
                observer.onCompleted();
            }
        }

        @Override
        public void deleteMedia(MediaRequest request, StreamObserver<DeleteMediaResponse> observer) {
            if (answer(request, observer)) {
                observer.onNext(DeleteMediaResponse.newBuilder()
                        .setMediaId(request.getMediaId()).setStatus(UploadStatus.DELETED).build());
                observer.onCompleted();
            }
        }
    }

    private MediaClient client(String token, long deadlineMs, long finalizeDeadlineMs) throws IOException {
        String name = InProcessServerBuilder.generateName();
        ServerInterceptor captureAuthorization = new ServerInterceptor() {
            @Override
            public <Q, A> ServerCall.Listener<Q> interceptCall(ServerCall<Q, A> call, Metadata headers,
                    ServerCallHandler<Q, A> next) {
                media.authorizations.add(headers.get(MediaClient.AUTHORIZATION));
                return next.startCall(call, headers);
            }
        };
        server = InProcessServerBuilder.forName(name)
                .addService(ServerInterceptors.intercept(media, captureAuthorization))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).build();
        return new MediaClient(channel, token, deadlineMs, finalizeDeadlineMs);
    }

    private MediaClient client() throws IOException {
        return client(TOKEN, 3000, 20000);
    }

    private static void assertApiError(Throwable thrown, HttpStatus status, String code) {
        assertThat(thrown).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getStatus()).isEqualTo(status);
            assertThat(e.getCode()).isEqualTo(code);
        });
    }

    @Test
    @DisplayName("createUpload: sends chat's token, CHAT_IMAGE, the owner and the type; returns the ticket")
    void createUploadSendsTokenAndPurpose() throws IOException {
        MediaClient.UploadTicket ticket = client().createUpload(OWNER, "image/png");

        assertThat(ticket).isEqualTo(new MediaClient.UploadTicket("upload-1",
                "https://r2.example/tmp/upload-1/source?sig=x", "image/png", 300));
        assertThat(media.authorizations).containsExactly("Bearer " + TOKEN);
        CreateUploadRequest sent = (CreateUploadRequest) media.requests.get(0);
        assertThat(sent.getPurpose()).isEqualTo(MediaPurpose.CHAT_IMAGE);
        assertThat(sent.getOwnerId()).isEqualTo(OWNER);
        assertThat(sent.getContentType()).isEqualTo("image/png");
    }

    @Test
    @DisplayName("finalizeUpload: READY becomes a FinalizedImage, with the long processing deadline")
    void finalizeUsesLongDeadline() throws IOException {
        MediaClient.FinalizedImage image = client(TOKEN, 3000, 20000).finalizeUpload("upload-1", OWNER);

        assertThat(image).isEqualTo(new MediaClient.FinalizedImage("media-1", "image/webp", 2048, 1365));
        UploadRequest sent = (UploadRequest) media.requests.get(0);
        assertThat(sent.getUploadId()).isEqualTo("upload-1");
        assertThat(sent.getOwnerId()).isEqualTo(OWNER);
        assertThat(sent.getPurpose()).isEqualTo(MediaPurpose.CHAT_IMAGE);
        // Processing gets the 20 s deadline, not the 3 s one used for quick calls.
        assertThat(media.deadlinesMs.get(0)).isGreaterThan(3000);
    }

    @Test
    @DisplayName("finalizeUpload: an upload that is not READY yet is a 409 ATTACHMENT_NOT_READY")
    void finalizeNotReady() throws IOException {
        media.finalizeStatus = UploadStatus.PROCESSING;
        MediaClient client = client();

        assertApiError(catchThrowable(() -> client.finalizeUpload("upload-1", OWNER)),
                HttpStatus.CONFLICT, "ATTACHMENT_NOT_READY");
    }

    @Test
    @DisplayName("downloadUrl and delete: send the media id and owner, with the short deadline")
    void downloadAndDelete() throws IOException {
        MediaClient client = client(TOKEN, 3000, 20000);

        assertThat(client.downloadUrl("media-1", OWNER))
                .isEqualTo(new MediaClient.SignedUrl("https://r2.example/chat/media-1.webp?sig=y", 300));
        client.delete("media-1", OWNER);

        assertThat(media.requests).hasSize(2).allSatisfy(request -> {
            MediaRequest sent = (MediaRequest) request;
            assertThat(sent.getMediaId()).isEqualTo("media-1");
            assertThat(sent.getOwnerId()).isEqualTo(OWNER);
            assertThat(sent.getPurpose()).isEqualTo(MediaPurpose.CHAT_IMAGE);
        });
        assertThat(media.deadlinesMs).allSatisfy(ms -> assertThat(ms).isBetween(1L, 3000L));
    }

    @Test
    @DisplayName("media errors become API errors the frontend can act on")
    void errorsAreTranslated() throws IOException {
        MediaClient client = client();
        record Case(Status status, HttpStatus http, String code) {}
        List<Case> cases = List.of(
                new Case(Status.NOT_FOUND, HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND"),
                new Case(Status.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST, "INVALID_IMAGE"),
                new Case(Status.FAILED_PRECONDITION, HttpStatus.CONFLICT, "ATTACHMENT_UNAVAILABLE"),
                new Case(Status.ABORTED, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_BUSY"),
                new Case(Status.RESOURCE_EXHAUSTED, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_BUSY"),
                new Case(Status.PERMISSION_DENIED, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE"),
                new Case(Status.UNAUTHENTICATED, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE"),
                new Case(Status.UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE"),
                new Case(Status.INTERNAL, HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE"));

        for (Case c : cases) {
            media.failWith = c.status();
            assertApiError(catchThrowable(() -> client.finalizeUpload("upload-1", OWNER)), c.http(), c.code());
        }
    }

    @Test
    @DisplayName("INVALID_ARGUMENT keeps media's reason, e.g. animated images")
    void invalidImageKeepsReason() throws IOException {
        media.failWith = Status.INVALID_ARGUMENT.withDescription("Animated images are not supported");
        MediaClient client = client();

        assertThat(catchThrowable(() -> client.finalizeUpload("upload-1", OWNER)))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getMessage()).isEqualTo("Animated images are not supported"));
    }

    @Test
    @DisplayName("a media that never answers hits the deadline: 503, not a hung request")
    void deadlineExceeded() throws IOException {
        media.hang = true;
        MediaClient client = client(TOKEN, 100, 100);

        assertApiError(catchThrowable(() -> client.createUpload(OWNER, "image/png")),
                HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE");
    }

    @Test
    @DisplayName("no token configured: 503 without calling media at all")
    void missingTokenNeverCallsMedia() throws IOException {
        for (String token : new String[] {null, "", "  "}) {
            MediaClient client = client(token, 3000, 20000);

            assertApiError(catchThrowable(() -> client.createUpload(OWNER, "image/png")),
                    HttpStatus.SERVICE_UNAVAILABLE, "MEDIA_UNAVAILABLE");
            tearDown();
        }
        assertThat(media.requests).isEmpty();
        assertThat(media.authorizations).isEmpty();
    }

    private static Throwable catchThrowable(Runnable call) {
        return org.assertj.core.api.Assertions.catchThrowable(call::run);
    }
}
