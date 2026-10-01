package com.ft_transcendence.orgservice.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.ft_transcendence.orgservice.service.RoomChangedEvent;
import com.fttranscendence.chat.grpc.ChatNotifyServiceGrpc;
import com.fttranscendence.chat.grpc.RoomChange;
import com.fttranscendence.chat.grpc.RoomChangedRequest;
import com.fttranscendence.chat.grpc.RoomChangedResponse;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;

/** ChatNotifyClient against a fake chat-service on a real local port. */
class ChatNotifyClientTest {

    private static final UUID ALICE = UUID.fromString("a215c5f8-d810-4518-ad4c-8d551eb6dfc4");
    private static final UUID BOB = UUID.fromString("b7c1d2e3-0000-4000-8000-000000000002");

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

    @Test
    @DisplayName("sends the room id as a string, the change and every user id")
    void sendsRequest() throws Exception {
        BlockingQueue<RoomChangedRequest> received = new LinkedBlockingQueue<>();
        server = ServerBuilder.forPort(0)
                .addService(new ChatNotifyServiceGrpc.ChatNotifyServiceImplBase() {
                    @Override
                    public void roomChanged(RoomChangedRequest request,
                            StreamObserver<RoomChangedResponse> responseObserver) {
                        received.add(request);
                        responseObserver.onNext(RoomChangedResponse.getDefaultInstance());
                        responseObserver.onCompleted();
                    }
                })
                .build()
                .start();
        channel = ManagedChannelBuilder.forAddress("localhost", server.getPort()).usePlaintext().build();

        new ChatNotifyClient(channel, 1000)
                .onRoomChanged(new RoomChangedEvent(42L, RoomChange.ROOM_ADDED, Set.of(ALICE, BOB)));

        RoomChangedRequest request = received.poll(5, TimeUnit.SECONDS);
        assertThat(request).as("chat-service received the call").isNotNull();
        assertThat(request.getRoomId()).isEqualTo("42");
        assertThat(request.getChange()).isEqualTo(RoomChange.ROOM_ADDED);
        assertThat(request.getUserIdsList()).containsExactlyInAnyOrder(ALICE.toString(), BOB.toString());
    }

    @Test
    @DisplayName("chat-service down: returns at once and throws nothing")
    void chatDownDoesNotFail() throws Exception {
        // Bind a port, then free it: nothing listens there any more.
        Server closed = ServerBuilder.forPort(0).build().start();
        int port = closed.getPort();
        closed.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        channel = ManagedChannelBuilder.forAddress("localhost", port).usePlaintext().build();

        long start = System.currentTimeMillis();
        new ChatNotifyClient(channel, 1000)
                .onRoomChanged(new RoomChangedEvent(42L, RoomChange.ROOM_REMOVED, Set.of(ALICE)));

        assertThat(System.currentTimeMillis() - start).isLessThan(500);
    }
}
