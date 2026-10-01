package com.fttranscendence.chatservice.grpc;

import java.util.List;
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
import com.fttranscendence.org.grpc.ListRoomMembersRequest;
import com.fttranscendence.org.grpc.ListRoomMembersResponse;
import com.fttranscendence.org.grpc.MemberResponse;
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
    public Membership membership(String userId , Long roomId) {
        try {
            CheckMembershipResponse response = stub
            .withDeadlineAfter(deadlineMs ,TimeUnit.MILLISECONDS)
            .checkMembership(CheckMembershipRequest.newBuilder()
            .setUserId(userId)
            .setRoomId(String.valueOf(roomId))
            .build());
            // role is "" from an org-service that does not send it yet
            return new Membership(response.getIsMember(), response.getRole());
        } catch( StatusRuntimeException e)
    {
            Status.Code code = e.getStatus().getCode();
            
            // org-service returns NOT_FOUND / INVALID_ARGUMENT for
            // unknown/invalid rooms: not a membership, but not an outage.
            if (code == Status.Code.NOT_FOUND || code == Status.Code.INVALID_ARGUMENT) {
                return Membership.NONE;
            }
            log.warn("org-service CheckMembership failed: {}", code, e);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable");
        }
    }
    public boolean isMember(String userId , Long roomId){
        return membership(userId ,roomId).member();
    }

    /**
     * Ids of every member of a room.
     *
     * org only answers a member, so askingUserId must be one: the sender of a
     * message that was just accepted is the natural choice.
     *
     * @throws ApiException 503 on any failure. org reports "room not found"
     *         and "not a member" as an unhandled exception (UNKNOWN), so they
     *         cannot be told apart from an outage here; callers treat every
     *         failure as "audience unknown".
     */
    public List<String> memberIds(Long roomId, String askingUserId) {
        try {
            ListRoomMembersResponse response = stub
            .withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
            .listRoomMembers(ListRoomMembersRequest.newBuilder()
            .setRoomId(String.valueOf(roomId))
            .setUserId(askingUserId)
            .build());
            return response.getMembersList().stream()
            .map(MemberResponse::getUserId)
            .toList();
        } catch (StatusRuntimeException e) {
            log.warn("org-service ListRoomMembers failed: {}", e.getStatus().getCode(), e);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable");
        }
    }
  @PreDestroy
  void shutdown() {
  if (ownedChannel != null) {
        ownedChannel.shutdown();
  }
  }
  }
