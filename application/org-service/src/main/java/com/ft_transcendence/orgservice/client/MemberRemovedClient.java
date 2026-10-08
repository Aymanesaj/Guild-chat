package com.ft_transcendence.orgservice.client;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.springframework.stereotype.Component;

@Component
public class MemberRemovedClient {
    private final ManagedChannel channel;
    private final MemberRemovedServiceGrpc.MemberRemovedServiceBlockingStub stub;

    public MemberRemovedClient() {
        this.channel = ManagedChannelBuilder
                .forAddress("member-removed-service", 9090)
                .usePlaintext()
                .build();

        this.stub = MemberRemovedServiceGrpc.newBlockingStub(channel);
    }

    public void notifyMemberRemoved(String roomId, String userId) {
        MemberRemovedRequest request = MemberRemovedRequest.newBuilder()
                .setRoomId(roomId)
                .setUserId(userId)
                .build();

        stub.memberRemoved(request);
    }

    public void notifyMemberRemoved(String roomId, String userId, String reason) {
        MemberRemovedRequest request = MemberRemovedRequest.newBuilder()
                .setRoomId(roomId)
                .setUserId(userId)
                .setReason(reason)
                .build();

        stub.memberRemoved(request);
    }

    public void shutdown() {
        channel.shutdown();
    }
}
