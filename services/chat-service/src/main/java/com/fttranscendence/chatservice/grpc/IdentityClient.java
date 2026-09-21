package com.fttranscendence.chatservice.grpc;

import java.util.Optional;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.identity.grpc.IdentityServiceGrpc;
import com.fttranscendence.identity.grpc.ValidateTokenRequest;
import com.fttranscendence.identity.grpc.ValidateTokenResponse;

import io.grpc.Channel;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.annotation.PreDestroy;

/**

* Asks identity-service to validate an access token (spec §2.4).
* Chat never verifies or issues tokens itself.
  */
  @Component
  public class IdentityClient {

  private static final Logger log =
  LoggerFactory.getLogger(IdentityClient.class);

  private final ManagedChannel ownedChannel;
  private final IdentityServiceGrpc.IdentityServiceBlockingStub stub;
  private final long deadlineMs;

  @Autowired
  public IdentityClient(
  @Value("${chat.grpc.identity.host}") String host,
  @Value("${chat.grpc.identity.port}") int port,
  @Value("${chat.grpc.deadline-ms}") long deadlineMs) {

   // Plaintext: this traffic never leaves the private Docker network.
   this.ownedChannel = ManagedChannelBuilder
           .forAddress(host, port)
           .usePlaintext()
           .build();

   this.stub = IdentityServiceGrpc
           .newBlockingStub(ownedChannel);

   this.deadlineMs = deadlineMs;
  }

  /**

  * For tests: an in-process channel, nothing to shut down.
    */
    IdentityClient(Channel channel, long deadlineMs) {
    this.ownedChannel = null;
    this.stub = IdentityServiceGrpc.newBlockingStub(channel);
    this.deadlineMs = deadlineMs;
    }

  /**

  * @return the user id when the token is valid, Optional.empty() when
  * ```
        the token is invalid
    ```
  * @throws ApiException 503 when identity cannot be reached — an outage is
  * ```
        not the same as a bad token, and must not become a 401
    ```

  */
  public Optional<String> validateToken(String token) {
        try {
        ValidateTokenResponse response = stub
        .withDeadlineAfter(
        deadlineMs,
        TimeUnit.MILLISECONDS)
        .validateToken(
        ValidateTokenRequest.newBuilder()
        .setToken(token)
        .build());

             if (!response.getValid()
                     || response.getUserId().isBlank()) {
                 return Optional.empty();
             }

             return Optional.of(response.getUserId());

         } catch (StatusRuntimeException e) {
            throw unavailable("ValidateToken", e);
        }
  }

  private ApiException unavailable(
  String rpc,
  StatusRuntimeException e) {

   Status.Code code = e.getStatus().getCode();

   log.warn(
           "identity-service {} failed: {}",
           rpc,
           code , e );

   return new ApiException(
           HttpStatus.SERVICE_UNAVAILABLE,
           "IDENTITY_UNAVAILABLE",
           "identity-service is unavailable");

  }

  @PreDestroy
  void shutdown() {
  if (ownedChannel != null) {
     ownedChannel.shutdown();
    }
  }
}
