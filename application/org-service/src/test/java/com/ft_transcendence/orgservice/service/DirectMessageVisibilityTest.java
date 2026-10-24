package com.ft_transcendence.orgservice.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;

import com.ft_transcendence.orgservice.client.IdentityGrpcClient;
import com.ft_transcendence.orgservice.exception.BadRequestException;
import com.ft_transcendence.orgservice.exception.NotFoundException;
import com.ft_transcendence.orgservice.messaging.RoomChange;
import com.ft_transcendence.orgservice.model.*;
import com.ft_transcendence.orgservice.repository.*;

class DirectMessageVisibilityTest {
    private final UUID alice = new UUID(0, 1);
    private final UUID bob = new UUID(0, 2);
    private final RoomRepository rooms = mock(RoomRepository.class);
    private final RoomMemberRepository members = mock(RoomMemberRepository.class);
    private final RoleRepository roles = mock(RoleRepository.class);
    private final MemberRoleRepository assignments = mock(MemberRoleRepository.class);
    private final IdentityGrpcClient identity = mock(IdentityGrpcClient.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final DirectMessageCreationService creation = spy(new DirectMessageCreationService(
            roles, rooms, members, assignments, events));
    private final RoomService service = new RoomService(rooms, members, roles, assignments, identity, creation, events);
    private final Room room = mock(Room.class);
    private final RoomMember a = new RoomMember();
    private final RoomMember b = new RoomMember();

    @BeforeEach
    void setup() {
        when(room.getId()).thenReturn(42L);
        when(room.getType()).thenReturn(RoomType.DM);
        when(room.getDmUser1()).thenReturn(alice);
        when(room.getDmUser2()).thenReturn(bob);
        when(rooms.findByIdForUpdate(42L)).thenReturn(Optional.of(room));
        a.setRoom(room); a.setUserId(alice);
        b.setRoom(room); b.setUserId(bob);
        when(members.findByRoomIdAndUserId(42L, alice)).thenReturn(Optional.of(a));
        when(members.findByUserId(alice)).thenReturn(List.of(a));
        when(members.findByUserId(bob)).thenReturn(List.of(b));
    }

    private void changed(RoomChange change, Set<UUID> users) {
        ArgumentCaptor<RoomChangedEvent> event = ArgumentCaptor.forClass(RoomChangedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().change()).isEqualTo(change);
        assertThat(event.getValue().roomDeleted()).isFalse();
        assertThat(event.getValue().userIds()).isEqualTo(users);
    }

    @Test
    void hideIsLocalAndIdempotentWithoutDeletingAnything() {
        service.hideDirectMessage(42L, alice);
        Instant hidden = a.getHiddenAt();
        service.hideDirectMessage(42L, alice);
        assertThat(a.getHiddenAt()).isEqualTo(hidden).isNotNull();
        assertThat(b.getHiddenAt()).isNull();
        assertThat(service.getDirectMessageRoomsByUserId(alice)).isEmpty();
        assertThat(service.getDirectMessageRoomsByUserId(bob)).hasSize(1);
        verify(members).save(a);
        verify(members, never()).delete(any());
        verify(members, never()).deleteAll(any(Iterable.class));
        verify(rooms, never()).delete(any());
        verifyNoInteractions(assignments, roles);
        changed(RoomChange.ROOM_REMOVED, Set.of(alice));
    }

    @Test
    void existingDmReopensOnlyCallerAndNeverCreatesDuplicate() {
        a.setHiddenAt(Instant.now()); b.setHiddenAt(Instant.now());
        when(rooms.findByTypeAndDmUser1AndDmUser2(RoomType.DM, alice, bob)).thenReturn(Optional.of(room));
        assertThat(service.createDirectMessageRoom(alice, bob).id()).isEqualTo(42L);
        service.createDirectMessageRoom(alice, bob);
        assertThat(a.getHiddenAt()).isNull();
        assertThat(b.getHiddenAt()).isNotNull();
        changed(RoomChange.ROOM_ADDED, Set.of(alice));
        verify(creation, never()).createDirectMessageRoom(any(), any(), any(), any());
        verify(rooms, never()).saveAndFlush(any());
    }

    @Test
    void creationRaceAlsoReopensExistingDm() {
        a.setHiddenAt(Instant.now());
        when(rooms.findByTypeAndDmUser1AndDmUser2(RoomType.DM, alice, bob))
                .thenReturn(Optional.empty(), Optional.of(room));
        when(identity.userExists(bob)).thenReturn(true);
        doThrow(new DataIntegrityViolationException("duplicate pair")).when(creation)
                .createDirectMessageRoom(alice, bob, alice, bob);
        assertThat(service.createDirectMessageRoom(alice, bob).id()).isEqualTo(42L);
        assertThat(a.getHiddenAt()).isNull();
        changed(RoomChange.ROOM_ADDED, Set.of(alice));
    }

    @Test
    void messageRevealsBothAndIsIdempotent() {
        a.setHiddenAt(Instant.now()); b.setHiddenAt(Instant.now());
        when(members.existsByRoomIdAndUserId(42L, bob)).thenReturn(true);
        when(members.findByRoomId(42L)).thenReturn(List.of(a, b));
        service.revealDm(42L, bob);
        service.revealDm(42L, bob);
        assertThat(a.getHiddenAt()).isNull();
        assertThat(b.getHiddenAt()).isNull();
        changed(RoomChange.ROOM_ADDED, Set.of(alice, bob));
    }

    @Test
    void revealNotifiesOnlyHiddenMembers() {
        a.setHiddenAt(Instant.now());
        when(members.existsByRoomIdAndUserId(42L, bob)).thenReturn(true);
        when(members.findByRoomId(42L)).thenReturn(List.of(a, b));
        service.revealDm(42L, bob);
        changed(RoomChange.ROOM_ADDED, Set.of(alice));
    }

    @Test
    void groupCannotBeHiddenAndRevealIsNoOp() {
        when(room.getType()).thenReturn(RoomType.GROUP);
        assertThatThrownBy(() -> service.hideDirectMessage(42L, alice)).isInstanceOf(BadRequestException.class);
        when(members.existsByRoomIdAndUserId(42L, alice)).thenReturn(true);
        service.revealDm(42L, alice);
        verify(members, never()).save(any());
        verifyNoInteractions(events);
    }

    @Test
    void missingRoomOrNonmemberCannotChangeVisibility() {
        assertThatThrownBy(() -> service.hideDirectMessage(99L, alice)).isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> service.hideDirectMessage(42L, bob)).isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> service.revealDm(42L, bob)).isInstanceOf(NotFoundException.class);
        verifyNoInteractions(events);
    }
}
