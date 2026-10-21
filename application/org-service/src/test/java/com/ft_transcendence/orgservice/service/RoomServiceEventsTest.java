package com.ft_transcendence.orgservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import com.ft_transcendence.orgservice.client.IdentityGrpcClient;
import com.ft_transcendence.orgservice.dto.CreateRoomRequest;
import com.ft_transcendence.orgservice.dto.RoomResponse;
import com.ft_transcendence.orgservice.dto.UpdateRoomRequest;
import com.ft_transcendence.orgservice.model.MemberRole;
import com.ft_transcendence.orgservice.model.Role;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.model.Room;
import com.ft_transcendence.orgservice.model.RoomMember;
import com.ft_transcendence.orgservice.model.RoomType;
import com.ft_transcendence.orgservice.repository.MemberRoleRepository;
import com.ft_transcendence.orgservice.repository.RoleRepository;
import com.ft_transcendence.orgservice.repository.RoomMemberRepository;
import com.ft_transcendence.orgservice.repository.RoomRepository;
import com.ft_transcendence.orgservice.messaging.RoomChange;

/**
 * Which RoomChangedEvents RoomService publishes, and to whom. Mocked
 * repositories, no database: the after-commit delivery is RoomEventPublisher's
 * job and Spring's, not tested here.
 */
class RoomServiceEventsTest {

    private static final long ROOM = 42L;
    private static final UUID OWNER = UUID.fromString("a215c5f8-d810-4518-ad4c-8d551eb6dfc4");
    private static final UUID BOB = UUID.fromString("b7c1d2e3-0000-4000-8000-000000000002");
    private static final UUID CAROL = UUID.fromString("c0000000-0000-4000-8000-000000000003");

    private RoomRepository roomRepository;
    private RoomMemberRepository roomMemberRepository;
    private RoleRepository roleRepository;
    private MemberRoleRepository memberRoleRepository;
    private IdentityGrpcClient identity;
    private DirectMessageCreationService dmCreation;
    private ApplicationEventPublisher events;
    private RoomService roomService;

    @BeforeEach
    void setUp() {
        roomRepository = mock(RoomRepository.class);
        roomMemberRepository = mock(RoomMemberRepository.class);
        roleRepository = mock(RoleRepository.class);
        memberRoleRepository = mock(MemberRoleRepository.class);
        identity = mock(IdentityGrpcClient.class);
        dmCreation = mock(DirectMessageCreationService.class);
        events = mock(ApplicationEventPublisher.class);
        roomService = new RoomService(roomRepository, roomMemberRepository, roleRepository,
                memberRoleRepository, identity, dmCreation, events);
    }

    /** Every RoomChangedEvent published, in order. */
    private List<RoomChangedEvent> published() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(events, atLeast(0)).publishEvent(captor.capture());
        return captor.getAllValues().stream()
                .filter(RoomChangedEvent.class::isInstance)
                .map(RoomChangedEvent.class::cast)
                .toList();
    }

    private static RoomMember member(UUID userId) {
        RoomMember member = new RoomMember();
        member.setUserId(userId);
        return member;
    }

    /** What findByRoomId returns: the room's members at query time. */
    private void membersAre(UUID... userIds) {
        when(roomMemberRepository.findByRoomId(ROOM))
                .thenReturn(Arrays.stream(userIds).map(RoomServiceEventsTest::member).toList());
    }

    private Room groupRoom() {
        Room room = mock(Room.class);
        when(room.getId()).thenReturn(ROOM);
        when(room.getType()).thenReturn(RoomType.GROUP);
        when(roomRepository.findById(ROOM)).thenReturn(Optional.of(room));
        when(roomRepository.findByIdForUpdate(ROOM)).thenReturn(Optional.of(room));
        return room;
    }

    private void isAdmin(UUID userId) {
        when(roomMemberRepository.existsByRoomIdAndUserId(ROOM, userId)).thenReturn(true);
        when(memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleNameIn(
                eq(ROOM), eq(userId), anyList())).thenReturn(true);
    }

    @Test
    @DisplayName("createRoom: ROOM_ADDED to the creator")
    void createRoom() {
        Room saved = mock(Room.class);
        when(saved.getId()).thenReturn(ROOM);
        when(saved.getType()).thenReturn(RoomType.GROUP);
        when(roomRepository.save(any())).thenReturn(saved);

        roomService.createRoom(new CreateRoomRequest("general"), OWNER);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_ADDED, Set.of(OWNER)));
    }

    @Test
    @DisplayName("new DM: delegate to the transaction-owning creation service")
    void newDirectMessage() {
        when(roomRepository.findByTypeAndDmUser1AndDmUser2(any(), any(), any())).thenReturn(Optional.empty());
        when(identity.userExists(BOB)).thenReturn(true);
        when(dmCreation.createDirectMessageRoom(any(), any(), eq(OWNER), eq(BOB)))
                .thenReturn(new RoomResponse(ROOM, null, null, RoomType.DM, null, BOB));

        roomService.createDirectMessageRoom(OWNER, BOB);

        // DM creation registers its own event inside DirectMessageCreationService's transaction.
        assertThat(published()).isEmpty();
        verify(dmCreation).createDirectMessageRoom(any(), any(), eq(OWNER), eq(BOB));
    }

    @Test
    @DisplayName("opening an existing DM: nothing is announced")
    void existingDirectMessage() {
        Room existing = mock(Room.class);
        when(existing.getDmUser1()).thenReturn(OWNER);
        when(existing.getDmUser2()).thenReturn(BOB);
        when(roomRepository.findByTypeAndDmUser1AndDmUser2(any(), any(), any())).thenReturn(Optional.of(existing));

        roomService.createDirectMessageRoom(OWNER, BOB);

        assertThat(published()).isEmpty();
    }

    @Test
    @DisplayName("addMember: ROOM_ADDED to the new member, ROOM_UPDATED to everyone else")
    void addMember() {
        groupRoom();
        isAdmin(OWNER);
        when(identity.userExists(CAROL)).thenReturn(true);
        when(roleRepository.findByRoomIdAndName(ROOM, RoleName.MEMBER)).thenReturn(Optional.of(new Role()));
        membersAre(OWNER, BOB, CAROL); // as seen after the insert

        roomService.addMember(ROOM, OWNER, CAROL);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_ADDED, Set.of(CAROL)),
                new RoomChangedEvent(ROOM, RoomChange.ROOM_UPDATED, Set.of(OWNER, BOB)));
    }

    @Test
    @DisplayName("leaveRoom: ROOM_REMOVED to the leaver, ROOM_UPDATED to those who stay")
    void leave() {
        groupRoom();
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, BOB)).thenReturn(Optional.of(member(BOB)));
        membersAre(OWNER, CAROL); // as seen after the delete

        roomService.leaveRoom(ROOM, BOB);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_REMOVED, Set.of(BOB)),
                new RoomChangedEvent(ROOM, RoomChange.ROOM_UPDATED, Set.of(OWNER, CAROL)));
    }

    @Test
    @DisplayName("kick (removeMember): the kicked user gets ROOM_REMOVED")
    void kick() {
        groupRoom();
        isAdmin(OWNER);
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, BOB)).thenReturn(Optional.of(member(BOB)));
        membersAre(OWNER);

        roomService.removeMember(ROOM, OWNER, BOB);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_REMOVED, Set.of(BOB)),
                new RoomChangedEvent(ROOM, RoomChange.ROOM_UPDATED, Set.of(OWNER)));
    }

    @Test
    @DisplayName("last owner leaves: departure plus explicit deletion even with no remaining recipients")
    void lastOwnerLeaves() {
        groupRoom();
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, OWNER)).thenReturn(Optional.of(member(OWNER)));
        when(memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                ROOM, OWNER, RoleName.OWNER)).thenReturn(true);
        when(roomMemberRepository.countByRoomId(ROOM)).thenReturn(1);
        membersAre(); // deleteRoom runs after the owner's row is gone

        roomService.leaveRoom(ROOM, OWNER);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_REMOVED, Set.of(OWNER)),
                new RoomChangedEvent(ROOM, RoomChange.ROOM_REMOVED, Set.of(), true));
    }

    @Test
    @DisplayName("deleteRoom: ROOM_REMOVED to every member")
    void deleteRoom() {
        groupRoom();
        membersAre(OWNER, BOB);

        roomService.deleteRoom(ROOM);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_REMOVED, Set.of(OWNER, BOB), true));
    }

    @Test
    @DisplayName("rename: ROOM_UPDATED to every member")
    void rename() {
        Room room = groupRoom();
        when(room.getName()).thenReturn("old");
        isAdmin(OWNER);
        membersAre(OWNER, BOB);

        roomService.updateRoom(ROOM, new UpdateRoomRequest("new"), OWNER);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_UPDATED, Set.of(OWNER, BOB)));
    }

    @Test
    @DisplayName("role change: ROOM_UPDATED to every member")
    void roleChange() {
        groupRoom();
        when(roomMemberRepository.existsByRoomIdAndUserId(ROOM, OWNER)).thenReturn(true);
        when(memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                ROOM, OWNER, RoleName.OWNER)).thenReturn(true);
        RoomMember bob = member(BOB);
        when(roomMemberRepository.findByRoomIdAndUserId(ROOM, BOB)).thenReturn(Optional.of(bob));
        Role admin = new Role();
        admin.setName(RoleName.ADMIN);
        when(roleRepository.findByRoomIdAndName(ROOM, RoleName.ADMIN)).thenReturn(Optional.of(admin));
        Role plain = new Role();
        plain.setName(RoleName.MEMBER);
        MemberRole current = new MemberRole();
        current.setRoomMember(bob);
        current.setRole(plain);
        when(memberRoleRepository.findByRoomMember(bob)).thenReturn(Optional.of(current));
        membersAre(OWNER, BOB);

        roomService.updateMemberRole(ROOM, BOB, RoleName.ADMIN, OWNER);

        assertThat(published()).containsExactly(
                new RoomChangedEvent(ROOM, RoomChange.ROOM_UPDATED, Set.of(OWNER, BOB)));
    }
}
