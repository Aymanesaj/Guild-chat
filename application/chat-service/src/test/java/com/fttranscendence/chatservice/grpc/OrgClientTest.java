package com.fttranscendence.chatservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.org.grpc.CheckMembershipRequest;
import com.fttranscendence.org.grpc.CheckMembershipResponse;
import com.fttranscendence.org.grpc.OrgServiceGrpc;

import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;

/**
 * Drives OrgClient against a fake org-service. The distinction that matters
 * here: "not a member" (a normal answer) versus "org is unavailable"
 * (an outage), which must not be confused with each other.
 */
class OrgClientTest {

    private static final String USER_ID = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final long ROOM = 42L;

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

    private OrgClient clientFor(
            Consumer<StreamObserver<CheckMembershipResponse>> behaviour,
            AtomicReference<CheckMembershipRequest> captured,
            long deadlineMs) throws IOException {

        String name = InProcessServerBuilder.generateName();

        server = InProcessServerBuilder.forName(name)
                .addService(new OrgServiceGrpc.OrgServiceImplBase() {
                    @Override
                    public void checkMembership(CheckMembershipRequest request,
                            StreamObserver<CheckMembershipResponse> responseObserver) {
                        if (captured != null) {
                            captured.set(request);
                        }
                        behaviour.accept(responseObserver);
                    }
                })
                .build()
                .start();

        channel = InProcessChannelBuilder.forName(name).build();
        return new OrgClient(channel, deadlineMs);
    }

    private static Consumer<StreamObserver<CheckMembershipResponse>> replies(boolean isMember) {
        return observer -> {
            observer.onNext(CheckMembershipResponse.newBuilder().setIsMember(isMember).build());
            observer.onCompleted();
        };
    }

    @Test
    void revealSendsSenderAndRoomIds() throws Exception {
        AtomicReference<com.fttranscendence.org.grpc.RevealDmRequest> captured = new AtomicReference<>();
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .addService(new OrgServiceGrpc.OrgServiceImplBase() {
                    @Override
                    public void revealDm(com.fttranscendence.org.grpc.RevealDmRequest request,
                            StreamObserver<com.fttranscendence.org.grpc.RevealDmResponse> observer) {
                        captured.set(request);
                        observer.onNext(com.fttranscendence.org.grpc.RevealDmResponse.getDefaultInstance());
                        observer.onCompleted();
                    }
                }).build().start();
        channel = InProcessChannelBuilder.forName(name).build();
        new OrgClient(channel, 500).revealDm(USER_ID, ROOM);
        assertThat(captured.get().getUserId()).isEqualTo(USER_ID);
        assertThat(captured.get().getRoomId()).isEqualTo("42");
    }

    @Test
    @DisplayName("member: true, and the room id is sent as a string")
    void returnsTrueForMember() throws Exception {
        AtomicReference<CheckMembershipRequest> captured = new AtomicReference<>();

        OrgClient client = clientFor(replies(true), captured, 500);

        assertThat(client.isMember(USER_ID, ROOM)).isTrue();
        assertThat(captured.get().getUserId()).isEqualTo(USER_ID);
        assertThat(captured.get().getRoomId()).isEqualTo("42");
    }

    @Test
    @DisplayName("non-member: false")
    void returnsFalseForNonMember() throws Exception {
        OrgClient client = clientFor(replies(false), null, 500);

        assertThat(client.isMember(USER_ID, ROOM)).isFalse();
    }

    @Test
    @DisplayName("unknown room (NOT_FOUND): false, because nobody is a member of a room that does not exist")
    void treatsNotFoundAsNotMember() throws Exception {
        OrgClient client = clientFor(
                observer -> observer.onError(Status.NOT_FOUND.asRuntimeException()), null, 500);

        assertThat(client.isMember(USER_ID, ROOM)).isFalse();
    }

    @Test
    @DisplayName("malformed room id (INVALID_ARGUMENT): false, not a 503")
    void treatsInvalidArgumentAsNotMember() throws Exception {
        OrgClient client = clientFor(
                observer -> observer.onError(Status.INVALID_ARGUMENT.asRuntimeException()), null, 500);

        assertThat(client.isMember(USER_ID, ROOM)).isFalse();
    }

    @Test
    @DisplayName("org down (UNAVAILABLE): 503 — never silently 'not a member'")
    void mapsUnavailableTo503() throws Exception {
        OrgClient client = clientFor(
                observer -> observer.onError(Status.UNAVAILABLE.asRuntimeException()), null, 500);

        assertThatThrownBy(() -> client.isMember(USER_ID, ROOM))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(e.getCode()).isEqualTo("ORG_UNAVAILABLE");
                });
    }

    @Test
    @DisplayName("org crashes (INTERNAL): 503, so a bug there cannot open a room here")
    void mapsInternalTo503() throws Exception {
        OrgClient client = clientFor(
                observer -> observer.onError(Status.INTERNAL.asRuntimeException()), null, 500);

        assertThatThrownBy(() -> client.isMember(USER_ID, ROOM)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("org hangs: the deadline fires instead of holding the request thread")
    void deadlineIsEnforced() throws Exception {
        OrgClient client = clientFor(observer -> {
            try {
                Thread.sleep(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, null, 100);

        long start = System.currentTimeMillis();

        assertThatThrownBy(() -> client.isMember(USER_ID, ROOM))
                .isInstanceOf(ApiException.class);

        assertThat(System.currentTimeMillis() - start).isLessThan(2000);
    }

    // ------------------------------------------------ role (for moderation)

    private static Consumer<StreamObserver<CheckMembershipResponse>> repliesWithRole(String role) {
        return observer -> {
            observer.onNext(CheckMembershipResponse.newBuilder().setIsMember(true).setRole(role).build());
            observer.onCompleted();
        };
    }

    @Test
    @DisplayName("membership carries the role org-service sends")
    void membershipCarriesRole() throws Exception {
        OrgClient client = clientFor(repliesWithRole("ADMIN"), null, 1000);

        Membership membership = client.membership(USER_ID, ROOM);

        assertThat(membership.member()).isTrue();
        assertThat(membership.role()).isEqualTo("ADMIN");
        assertThat(membership.canModerate()).isTrue();
    }

    @Test
    @DisplayName("no role from org-service (the field is not sent yet) means a plain member")
    void missingRoleIsPlainMember() throws Exception {
        OrgClient client = clientFor(replies(true), null, 1000);

        Membership membership = client.membership(USER_ID, ROOM);

        assertThat(membership.member()).isTrue();
        assertThat(membership.role()).isEmpty();
        assertThat(membership.canModerate()).isFalse();
    }

    @Test
    @DisplayName("NOT_FOUND from org-service is Membership.NONE, which can never moderate")
    void notFoundIsNone() throws Exception {
        OrgClient client = clientFor(
                observer -> observer.onError(io.grpc.Status.NOT_FOUND.asRuntimeException()), null, 1000);

        assertThat(client.membership(USER_ID, ROOM)).isEqualTo(Membership.NONE);
        assertThat(new Membership(false, "ADMIN").canModerate())
                .as("a role without membership grants nothing").isFalse();
    }
}
