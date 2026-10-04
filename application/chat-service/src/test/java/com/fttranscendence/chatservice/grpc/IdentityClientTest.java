package com.fttranscendence.chatservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.identity.grpc.IdentityServiceGrpc;
import com.fttranscendence.identity.grpc.ValidateTokenRequest;
import com.fttranscendence.identity.grpc.ValidateTokenResponse;

import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;

/**
 * Drives IdentityClient against a fake identity-service on an in-process gRPC
 * server: no Docker, no network, but the real generated stubs and the real
 * status-code handling.
 */
class IdentityClientTest {

    private static final String TOKEN = "header.payload.signature";
    private static final String USER_ID = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    private Server server;
    private ManagedChannel channel;

    @AfterEach
    void tearDown() {
        if (channel != null) {
            channel.shutdownNow();
        }
        if (server != null) {
            server.shutdownNow();
        }
    }

    /** Starts a fake identity-service whose ValidateToken behaves as given. */
    private IdentityClient clientFor(
            Consumer<StreamObserver<ValidateTokenResponse>> behaviour,
            AtomicReference<ValidateTokenRequest> captured,
            long deadlineMs) throws IOException {

        String name = InProcessServerBuilder.generateName();

        server = InProcessServerBuilder.forName(name)
                .addService(new IdentityServiceGrpc.IdentityServiceImplBase() {
                    @Override
                    public void validateToken(ValidateTokenRequest request,
                            StreamObserver<ValidateTokenResponse> responseObserver) {
                        if (captured != null) {
                            captured.set(request);
                        }
                        behaviour.accept(responseObserver);
                    }
                })
                .build()
                .start();

        channel = InProcessChannelBuilder.forName(name).build();
        return new IdentityClient(channel, deadlineMs);
    }

    private static Consumer<StreamObserver<ValidateTokenResponse>> replies(ValidateTokenResponse response) {
        return observer -> {
            observer.onNext(response);
            observer.onCompleted();
        };
    }

    @Test
    @DisplayName("valid token: returns the user id and sends the token as given")
    void returnsUserIdForValidToken() throws Exception {
        AtomicReference<ValidateTokenRequest> captured = new AtomicReference<>();
        IdentityClient client = clientFor(replies(ValidateTokenResponse.newBuilder()
                .setValid(true)
                .setUserId(USER_ID)
                .setUsername("alice")
                .build()), captured, 500);

        Optional<String> userId = client.validateToken(TOKEN);

        assertThat(userId).contains(USER_ID);
        assertThat(captured.get().getToken()).isEqualTo(TOKEN);
    }

    @Test
    @DisplayName("invalid token: empty result, not an exception")
    void returnsEmptyForInvalidToken() throws Exception {
        IdentityClient client = clientFor(
                replies(ValidateTokenResponse.newBuilder().setValid(false).build()), null, 500);

        assertThat(client.validateToken("tampered")).isEmpty();
    }

    @Test
    @DisplayName("valid=true but no user id is treated as invalid, never as an anonymous user")
    void treatsBlankUserIdAsInvalid() throws Exception {
        IdentityClient client = clientFor(
                replies(ValidateTokenResponse.newBuilder().setValid(true).setUserId("").build()),
                null, 500);

        assertThat(client.validateToken(TOKEN)).isEmpty();
    }

    @Test
    @DisplayName("identity down: 503, never a 401 — an outage is not a bad token")
    void mapsUnavailableTo503() throws Exception {
        IdentityClient client = clientFor(
                observer -> observer.onError(Status.UNAVAILABLE.asRuntimeException()), null, 500);

        assertThatThrownBy(() -> client.validateToken(TOKEN))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(e.getCode()).isEqualTo("IDENTITY_UNAVAILABLE");
                });
    }

    @Test
    @DisplayName("identity hangs: the deadline fires instead of blocking the request thread")
    void deadlineIsEnforced() throws Exception {
        IdentityClient client = clientFor(observer -> {
            try {
                Thread.sleep(3000); // never answers within the deadline
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, null, 100);

        long start = System.currentTimeMillis();

        assertThatThrownBy(() -> client.validateToken(TOKEN))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));

        assertThat(System.currentTimeMillis() - start)
                .as("must give up at the deadline, not wait for the server")
                .isLessThan(2000);
    }

    @Test
    @DisplayName("an internal error in identity is also a 503, not a silent success")
    void mapsInternalErrorTo503() throws Exception {
        IdentityClient client = clientFor(
                observer -> observer.onError(Status.INTERNAL.asRuntimeException()), null, 500);

        assertThatThrownBy(() -> client.validateToken(TOKEN)).isInstanceOf(ApiException.class);
    }
}
