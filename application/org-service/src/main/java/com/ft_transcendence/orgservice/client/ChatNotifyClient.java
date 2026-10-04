package com.ft_transcendence.orgservice.client;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.ft_transcendence.orgservice.service.RoomChangedEvent;
import com.fttranscendence.chat.grpc.ChatNotifyServiceGrpc;
import com.fttranscendence.chat.grpc.RoomChangedRequest;
import com.fttranscendence.chat.grpc.RoomChangedResponse;

import io.grpc.Channel;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.stub.StreamObserver;
import jakarta.annotation.PreDestroy;

/**
 * Tells chat-service that a room changed, so chat can push it to the affected
 * users' open sockets (room.added / room.removed / room.updated) and their
 * room lists update without polling.
 *
 * Fire-and-forget: the call is asynchronous and its outcome only logged. A
 * chat-service that is down must never fail or slow down a room operation;
 * the frontend still refetches on reconnect and polls slowly as a fallback.
 */
@Component
public class ChatNotifyClient {

    private static final Logger log = LoggerFactory.getLogger(ChatNotifyClient.class);

    private final ManagedChannel ownedChannel;
    private final ChatNotifyServiceGrpc.ChatNotifyServiceStub stub;
    private final long deadlineMs;

    @Autowired
    public ChatNotifyClient(
            @Value("${chat.grpc.host:chat-service}") String host,
            @Value("${chat.grpc.port:9090}") int port,
            @Value("${chat.grpc.deadline-ms:1000}") long deadlineMs) {
        // Plaintext: this traffic never leaves the private Docker network.
        // build() does not connect; the first call does.
        this(ManagedChannelBuilder.forAddress(host, port).usePlaintext().build(), deadlineMs);
    }

    /** For tests: a channel the test owns and shuts down. */
    ChatNotifyClient(Channel channel, long deadlineMs) {
        this.ownedChannel = channel instanceof ManagedChannel managed ? managed : null;
        this.stub = ChatNotifyServiceGrpc.newStub(channel);
        this.deadlineMs = deadlineMs;
    }

    /**
     * Forwards a RoomChangedEvent to chat-service's RoomChanged RPC.
     *
     * AFTER_COMMIT: a rolled-back change is never announced, and the users'
     * refetch cannot race the commit and read the old state.
     * fallbackExecution: also runs when published outside a transaction
     * (RoomService.createDirectMessageRoom commits inside another bean and
     * publishes afterwards).
     *
     * Returns at once; the RPC completes on a gRPC thread.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRoomChanged(RoomChangedEvent event) {
        RoomChangedRequest request = RoomChangedRequest.newBuilder()
                .setRoomId(String.valueOf(event.roomId()))
                .setChange(event.change())
                .addAllUserIds(event.userIds().stream().map(UUID::toString).toList())
                .build();

        stub.withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
                .roomChanged(request, new StreamObserver<>() {
                    @Override
                    public void onNext(RoomChangedResponse response) {
                    }

                    @Override
                    public void onError(Throwable error) {
                        log.warn("chat-service RoomChanged failed for room={} change={}: {}",
                                event.roomId(), event.change(), error.toString());
                    }

                    @Override
                    public void onCompleted() {
                        log.debug("chat-service notified: room={} change={} users={}",
                                event.roomId(), event.change(), event.userIds().size());
                    }
                });
    }

    @PreDestroy
    void shutdown() {
        if (ownedChannel != null) {
            ownedChannel.shutdown();
        }
    }
}
