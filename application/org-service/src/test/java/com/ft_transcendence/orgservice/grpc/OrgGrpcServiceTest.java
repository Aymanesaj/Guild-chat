package com.ft_transcendence.orgservice.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.service.RoomService;
import com.fttranscendence.org.grpc.CheckMembershipRequest;
import com.fttranscendence.org.grpc.CheckMembershipResponse;

import io.grpc.stub.StreamObserver;

/**
 * CheckMembership as chat-service sees it: is_member plus the caller's role,
 * which chat uses to let OWNER/ADMIN delete other members' messages.
 */
class OrgGrpcServiceTest {

    private static final long ROOM = 42L;
    private static final UUID USER = UUID.fromString("a215c5f8-d810-4518-ad4c-8d551eb6dfc4");

    private RoomService roomService;
    private OrgGrpcService grpcService;

    @BeforeEach
    void setUp() {
        roomService = mock(RoomService.class);
        grpcService = new OrgGrpcService(roomService);
    }

    @SuppressWarnings("unchecked")
    private CheckMembershipResponse check() {
        StreamObserver<CheckMembershipResponse> observer = mock(StreamObserver.class);
        grpcService.checkMembership(
                CheckMembershipRequest.newBuilder()
                        .setRoomId(String.valueOf(ROOM))
                        .setUserId(USER.toString())
                        .build(),
                observer);

        ArgumentCaptor<CheckMembershipResponse> response = ArgumentCaptor.forClass(CheckMembershipResponse.class);
        verify(observer).onNext(response.capture());
        verify(observer).onCompleted();
        return response.getValue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void revealParsesIdsAndCompletes() {
        StreamObserver<com.fttranscendence.org.grpc.RevealDmResponse> observer = mock(StreamObserver.class);
        grpcService.revealDm(com.fttranscendence.org.grpc.RevealDmRequest.newBuilder()
                .setRoomId("42").setUserId(USER.toString()).build(), observer);
        verify(roomService).revealDm(ROOM, USER);
        verify(observer).onNext(com.fttranscendence.org.grpc.RevealDmResponse.getDefaultInstance());
        verify(observer).onCompleted();
    }

    @Test
    @SuppressWarnings("unchecked")
    void revealRejectsMalformedIds() {
        StreamObserver<com.fttranscendence.org.grpc.RevealDmResponse> observer = mock(StreamObserver.class);
        grpcService.revealDm(com.fttranscendence.org.grpc.RevealDmRequest.newBuilder()
                .setRoomId("bad").setUserId(USER.toString()).build(), observer);
        ArgumentCaptor<Throwable> error = ArgumentCaptor.forClass(Throwable.class);
        verify(observer).onError(error.capture());
        assertThat(io.grpc.Status.fromThrowable(error.getValue()).getCode())
                .isEqualTo(io.grpc.Status.Code.INVALID_ARGUMENT);
        org.mockito.Mockito.verifyNoInteractions(roomService);
    }

    @Test
    @DisplayName("a member gets is_member=true and their role name")
    void memberGetsRole() {
        for (RoleName role : RoleName.values()) {
            when(roomService.isUserInRoom(ROOM, USER)).thenReturn(true);
            when(roomService.findRoleInRoom(ROOM, USER)).thenReturn(Optional.of(role));

            CheckMembershipResponse response = check();

            assertThat(response.getIsMember()).isTrue();
            assertThat(response.getRole()).isEqualTo(role.name());
        }
    }

    @Test
    @DisplayName("a non-member gets is_member=false, role \"\", and no role lookup is made")
    void nonMemberGetsNoRole() {
        when(roomService.isUserInRoom(ROOM, USER)).thenReturn(false);

        CheckMembershipResponse response = check();

        assertThat(response.getIsMember()).isFalse();
        assertThat(response.getRole()).isEmpty();
        verify(roomService, never()).findRoleInRoom(any(), any());
    }

    @Test
    @DisplayName("a member with no role row still answers is_member=true, role \"\" (no error)")
    void memberWithoutRoleRow() {
        when(roomService.isUserInRoom(ROOM, USER)).thenReturn(true);
        when(roomService.findRoleInRoom(ROOM, USER)).thenReturn(Optional.empty());

        CheckMembershipResponse response = check();

        assertThat(response.getIsMember()).isTrue();
        assertThat(response.getRole()).isEmpty();
    }
}
