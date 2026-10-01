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
import com.fttranscendence.org.grpc.ListRoomMembersRequest;
import com.fttranscendence.org.grpc.ListRoomMembersResponse;
import com.fttranscendence.org.grpc.MemberResponse;
import com.fttranscendence.org.grpc.OrgServiceGrpc;

import io.grpc.ManagedChannel;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;

/** OrgClient.memberIds against a fake org-service (ListRoomMembers). */
class OrgClientMembersTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
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
            Consumer<StreamObserver<ListRoomMembersResponse>> behaviour,
            AtomicReference<ListRoomMembersRequest> captured) throws IOException {

        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .addService(new OrgServiceGrpc.OrgServiceImplBase() {
                    @Override
                    public void listRoomMembers(ListRoomMembersRequest request,
                            StreamObserver<ListRoomMembersResponse> responseObserver) {
                        if (captured != null) {
                            captured.set(request);
                        }
                        behaviour.accept(responseObserver);
                    }
                })
                .build()
                .start();

        channel = InProcessChannelBuilder.forName(name).build();
        return new OrgClient(channel, 1000);
    }

    private static MemberResponse member(String userId, String role) {
        return MemberResponse.newBuilder().setUserId(userId).setRole(role).build();
    }

    @Test
    @DisplayName("returns every member's id, and asks as the given user with the room id as a string")
    void returnsMemberIds() throws Exception {
        AtomicReference<ListRoomMembersRequest> captured = new AtomicReference<>();
        OrgClient client = clientFor(observer -> {
            observer.onNext(ListRoomMembersResponse.newBuilder()
                    .addMembers(member(ALICE, "OWNER"))
                    .addMembers(member(BOB, "MEMBER"))
                    .build());
            observer.onCompleted();
        }, captured);

        assertThat(client.memberIds(ROOM, ALICE)).containsExactly(ALICE, BOB);
        assertThat(captured.get().getRoomId()).isEqualTo("42");
        assertThat(captured.get().getUserId()).isEqualTo(ALICE);
    }

    @Test
    @DisplayName("any failure, including org's UNKNOWN for 'not a member', is a 503")
    void failureIs503() throws Exception {
        OrgClient client = clientFor(observer -> observer.onError(Status.UNKNOWN.asRuntimeException()), null);

        assertThatThrownBy(() -> client.memberIds(ROOM, ALICE))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(e.getCode()).isEqualTo("ORG_UNAVAILABLE");
                });
    }
}
