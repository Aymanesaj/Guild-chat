package com.fttranscendence.chatservice.grpc;

import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.org.grpc.CheckMembershipRequest;
import com.fttranscendence.org.grpc.CheckMembershipResponse;
import com.fttranscendence.org.grpc.OrgServiceGrpc;

import io.grpc.Channel;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.annotation.PreDestroy;

/**

* Asks org-service whether a user belongs to a room.
*
* Chat owns no membership data and must never cache it in its own database.
  */
  @Component
  public class OrgClient {

  private static final Logger log =
  LoggerFactory.getLogger(OrgClient.class);

  private final ManagedChannel ownedChannel;
  private final OrgServiceGrpc.OrgServiceBlockingStub stub;
  private final long deadlineMs;

  @Autowired
  public OrgClient(
  @Value("${chat.grpc.org.host}") String host,
  @Value("${chat.grpc.org.port}") int port,
  @Value("${chat.grpc.deadline-ms}") long deadlineMs) {
        this.ownedChannel = ManagedChannelBuilder
           .forAddress(host, port)
           .usePlaintext()
           .build();
        this.ownedChannel.getState(true);

        this.stub = OrgServiceGrpc
           .newBlockingStub(ownedChannel);

        this.deadlineMs = deadlineMs;
  }

  /**

  * For tests: an in-process channel.
    */
    OrgClient(Channel channel, long deadlineMs) {
    this.ownedChannel = null;
    this.stub = OrgServiceGrpc.newBlockingStub(channel);
    this.deadlineMs = deadlineMs;
    }

  /**

  * The proto carries ids as strings, so the Long room id is converted here.
    */
    public boolean isMember(String userId, Long roomId) {
    try {
    CheckMembershipResponse response = stub
    .withDeadlineAfter(
    deadlineMs,
    TimeUnit.MILLISECONDS)
    .checkMembership(
    CheckMembershipRequest.newBuilder()
    .setUserId(userId)
    .setRoomId(String.valueOf(roomId))
    .build());

     return response.getIsMember();

    } catch (StatusRuntimeException e) {
    Status.Code code = e.getStatus().getCode();

     // org-service returns NOT_FOUND / INVALID_ARGUMENT for
     // unknown/invalid rooms: not a membership, but not an outage.
     if (code == Status.Code.NOT_FOUND
             || code == Status.Code.INVALID_ARGUMENT) {
         return false;
     }

     log.warn(
             "org-service CheckMembership failed: {}",
             code ,e );

     throw new ApiException(
             HttpStatus.SERVICE_UNAVAILABLE,
             "ORG_UNAVAILABLE",
             "org-service is unavailable");

    }
    }

  @PreDestroy
  void shutdown() {
  if (ownedChannel != null) {
        ownedChannel.shutdown();
  }
  }
  }
