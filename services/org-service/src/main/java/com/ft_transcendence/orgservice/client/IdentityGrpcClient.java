package com.ft_transcendence.orgservice.client;

import com.fttranscendence.identity.grpc.GetUserRequest;
import com.fttranscendence.identity.grpc.IdentityServiceGrpc;
import com.fttranscendence.identity.grpc.UserResponse;
import com.fttranscendence.identity.grpc.ValidateTokenRequest;
import com.fttranscendence.identity.grpc.ValidateTokenResponse;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class IdentityGrpcClient {

    private final ManagedChannel channel;
    private final IdentityServiceGrpc.IdentityServiceBlockingStub stub;

    public IdentityGrpcClient() {
        this.channel = ManagedChannelBuilder
                .forAddress("identity-service", 9090)
                .usePlaintext()
                .build();

        this.stub = IdentityServiceGrpc.newBlockingStub(channel);
    }

    public ValidateTokenResponse validateToken(String token) {
        ValidateTokenRequest request = ValidateTokenRequest.newBuilder()
                .setToken(token)
                .build();

        return stub.validateToken(request);
    }

    public UserResponse getUser(UUID userId) {

        GetUserRequest request = GetUserRequest.newBuilder()
                .setUserId(userId.toString())
                .build();

        return stub.getUser(request);
    }

    public boolean userExists(UUID userId) {
        GetUserRequest request = GetUserRequest.newBuilder()
                .setUserId(userId.toString())
                .build();

        try {
            stub.getUser(request);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}