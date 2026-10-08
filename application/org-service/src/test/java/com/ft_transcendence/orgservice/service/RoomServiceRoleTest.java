package com.ft_transcendence.orgservice.service;

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

import org.springframework.context.ApplicationEventPublisher;

import com.ft_transcendence.orgservice.client.IdentityGrpcClient;
import com.ft_transcendence.orgservice.model.MemberRole;
import com.ft_transcendence.orgservice.model.Role;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.model.RoomMember;
import com.ft_transcendence.orgservice.repository.MemberRoleRepository;
import com.ft_transcendence.orgservice.repository.RoleRepository;
import com.ft_transcendence.orgservice.repository.RoomMemberRepository;
import com.ft_transcendence.orgservice.repository.RoomRepository;

/** RoomService.findRoleInRoom, with mocked repositories: no database. */
class RoomServiceRoleTest {

    private static final long ROOM = 42L;
    private static final UUID USER = UUID.fromString("a215c5f8-d810-4518-ad4c-8d551eb6dfc4");

    private RoomMemberRepository roomMemberRepository;
    private MemberRoleRepository memberRoleRepository;
    private RoomService roomService;

    @BeforeEach
    void setUp() {
        roomMemberRepository = mock(RoomMemberRepository.class);
        memberRoleRepository = mock(MemberRoleRepository.class);
        roomService = new RoomService(
                mock(RoomRepository.class),
                roomMemberRepository,
                mock(RoleRepository.class),
                memberRoleRepository,
                mock(IdentityGrpcClient.class),
                mock(DirectMessageCreationService.class),
                mock(ApplicationEventPublisher.class));
    }

    @Test
    @DisplayName("returns the role assigned to the user's membership in that room")
    void returnsRole() {
        RoomMember member = new RoomMember();
        Role admin = new Role();
        admin.setName(RoleName.ADMIN);
        MemberRole memberRole = new MemberRole();
        memberRole.setRoomMember(member);
        memberRole.setRole(admin);

        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, USER)).thenReturn(Optional.of(member));
        when(memberRoleRepository.findByRoomMember(member)).thenReturn(Optional.of(memberRole));

        assertThat(roomService.findRoleInRoom(ROOM, USER)).contains(RoleName.ADMIN);
    }

    @Test
    @DisplayName("not a member: empty, and no role lookup")
    void notAMember() {
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, USER)).thenReturn(Optional.empty());

        assertThat(roomService.findRoleInRoom(ROOM, USER)).isEmpty();
        verify(memberRoleRepository, never()).findByRoomMember(any());
    }

    @Test
    @DisplayName("a member with no role row: empty, not an exception")
    void memberWithoutRole() {
        RoomMember member = new RoomMember();
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, USER)).thenReturn(Optional.of(member));
        when(memberRoleRepository.findByRoomMember(member)).thenReturn(Optional.empty());

        assertThat(roomService.findRoleInRoom(ROOM, USER)).isEmpty();
    }
}
