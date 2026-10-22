package com.ft_transcendence.orgservice.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.ft_transcendence.orgservice.client.IdentityGrpcClient;
import com.ft_transcendence.orgservice.dto.*;
import com.ft_transcendence.orgservice.exception.*;
import com.ft_transcendence.orgservice.messaging.*;
import com.ft_transcendence.orgservice.model.*;
import com.ft_transcendence.orgservice.repository.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.MessagePostProcessor;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.*;
import org.springframework.context.event.EventListener;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = RoomTimelineIntegrationTest.Config.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:timeline;MODE=PostgreSQL;DB_CLOSE_DELAY=-1"})
class RoomTimelineIntegrationTest {
    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    @EntityScan(basePackageClasses = Room.class)
    @EnableJpaRepositories(basePackageClasses = RoomRepository.class)
    @Import({RoomService.class, DirectMessageCreationService.class, RoomTimelinePublisher.class, RoomEventPublisher.class, InternalEvents.class})
    static class Config {}

    static class InternalEvents {
        final List<RoomTimelineEvent> emitted = new ArrayList<>();
        final List<RoomChangedEvent> changed = new ArrayList<>();
        @EventListener public void capture(RoomTimelineEvent event) { emitted.add(event); }
        @EventListener public void captureChange(RoomChangedEvent event) { changed.add(event); }
    }

    @MockitoBean RabbitTemplate rabbit;
    @MockitoBean RabbitAdmin admin;
    @MockitoBean IdentityGrpcClient identity;
    @Autowired RoomService service;
    @Autowired RoomRepository rooms;
    @Autowired InternalEvents internal;
    @Autowired ApplicationEventPublisher events;
    @Autowired PlatformTransactionManager manager;
    final List<RoomTimelineMessage> sent = new ArrayList<>();
    final List<RoomChangedMessage> changesSent = new ArrayList<>();
    UUID owner;
    long room;
    Instant before;

    @BeforeEach
    void setup() {
        clear();
        when(identity.userExists(any())).thenReturn(true);
        doAnswer(call -> {
            sent.add(call.getArgument(2));
            call.getArgument(4, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).convertAndSend(eq("guildchat.room-events"), eq("room.timeline"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
        doAnswer(call -> {
            changesSent.add(call.getArgument(2));
            call.getArgument(4, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).convertAndSend(eq("guildchat.room-events"), eq("room.changed"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
        owner = UUID.randomUUID(); before = Instant.now();
        room = service.createRoom(new CreateRoomRequest("original", null), owner).id();
    }

    private UUID add(RoleName role) {
        UUID user = UUID.randomUUID();
        service.addMember(room, owner, user);
        if (role == RoleName.ADMIN) service.updateMemberRole(room, user, role, owner);
        clear(); return user;
    }

    private void clear() {
        internal.emitted.clear(); internal.changed.clear(); sent.clear(); changesSent.clear();
    }

    private void assertRoomUpdated(UUID... recipients) {
        assertThat(internal.changed).containsExactly(new RoomChangedEvent(room,
                RoomChange.ROOM_UPDATED, java.util.Set.of(recipients)));
        assertThat(changesSent).singleElement().satisfies(message -> {
            assertThat(message.roomId()).isEqualTo(Long.toString(room));
            assertThat(message.change()).isEqualTo(RoomChange.ROOM_UPDATED);
            assertThat(message.roomDeleted()).isFalse();
            assertThat(message.userIds()).containsExactlyInAnyOrderElementsOf(
                    java.util.Arrays.stream(recipients).map(UUID::toString).toList());
        });
    }

    @Test
    void descriptionOnlyEditCommitsRoomUpdateWithoutRenameAndEmptyStringClears() {
        for (String description : List.of("Room description", "")) {
            clear();
            new TransactionTemplate(manager).executeWithoutResult(status -> {
                var response = service.updateRoom(room, new UpdateRoomRequest("original", description), owner);
                assertThat(response.description()).isEqualTo(description);
                assertThat(internal.changed).hasSize(1);
                assertThat(internal.emitted).isEmpty();
                assertThat(changesSent).isEmpty();
                assertThat(sent).isEmpty();
            });
            var persisted = rooms.findById(room).orElseThrow();
            assertThat(persisted.getName()).isEqualTo("original");
            assertThat(persisted.getDescription()).isEqualTo(description);
            assertRoomUpdated(owner);
            assertThat(internal.emitted).isEmpty();
            assertThat(sent).isEmpty();
        }
    }

    @Test
    void combinedEditPersistsBothFieldsAndPublishesExactlyOneCorrectRenameAfterCommit() {
        service.updateRoom(room, new UpdateRoomRequest("original", "Old description"), owner);
        clear();
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            var response = service.updateRoom(room, new UpdateRoomRequest("renamed", "New description"), owner);
            assertThat(response.name()).isEqualTo("renamed");
            assertThat(response.description()).isEqualTo("New description");
            assertThat(internal.emitted).hasSize(1);
            assertThat(sent).isEmpty();
            assertThat(changesSent).isEmpty();
        });
        var persisted = rooms.findById(room).orElseThrow();
        assertThat(persisted.getName()).isEqualTo("renamed");
        assertThat(persisted.getDescription()).isEqualTo("New description");
        assertThat(internal.emitted).hasSize(1);
        assertThat(sent).hasSize(1);
        assertEvent(0, RoomTimelineType.ROOM_RENAMED, owner, null, null, null, "renamed", "original");
        assertRoomUpdated(owner);
    }

    @Test
    void nameOnlyEditPreservesExistingDescriptionAndPublishesRenameAndRoomUpdate() {
        service.updateRoom(room, new UpdateRoomRequest("original", "Keep this description"), owner);
        clear();
        service.updateRoom(room, new UpdateRoomRequest("name only", null), owner);
        var persisted = rooms.findById(room).orElseThrow();
        assertThat(persisted.getName()).isEqualTo("name only");
        assertThat(persisted.getDescription()).isEqualTo("Keep this description");
        assertThat(internal.emitted).hasSize(1);
        assertThat(sent).hasSize(1);
        assertEvent(0, RoomTimelineType.ROOM_RENAMED, owner, null, null, null, "name only", "original");
        assertRoomUpdated(owner);
    }

    @Test
    void unchangedRequestsWithNullEqualOrAlreadyEmptyDescriptionsRejectWithoutEvents() {
        for (String description : java.util.Arrays.asList(null, "Existing description", "")) {
            new TransactionTemplate(manager).executeWithoutResult(status ->
                    rooms.findById(room).orElseThrow().setDescription(description));
            for (String requested : java.util.Arrays.asList(null, description)) {
                clear();
                assertThatThrownBy(() -> service.updateRoom(room,
                        new UpdateRoomRequest("original", requested), owner))
                        .isInstanceOf(BadRequestException.class)
                        .hasMessage("Room name and description are unchanged");
                assertThat(rooms.findById(room).orElseThrow().getDescription()).isEqualTo(description);
                assertThat(internal.emitted).isEmpty(); assertThat(internal.changed).isEmpty();
                assertThat(sent).isEmpty(); assertThat(changesSent).isEmpty();
            }
        }
    }

    @Test
    void descriptionAndCombinedEditsRetainMemberAndOutsiderRestrictionsAndAdminPermission() {
        UUID member = add(RoleName.MEMBER);
        UUID adminUser = add(RoleName.ADMIN);
        UUID outsider = UUID.randomUUID();
        for (String name : List.of("original", "forbidden rename")) {
            assertThatThrownBy(() -> service.updateRoom(room,
                    new UpdateRoomRequest(name, "Forbidden"), member)).isInstanceOf(ForbiddenException.class);
            assertThatThrownBy(() -> service.updateRoom(room,
                    new UpdateRoomRequest(name, "Forbidden"), outsider)).isInstanceOf(NotFoundException.class);
        }
        var persisted = rooms.findById(room).orElseThrow();
        assertThat(persisted.getName()).isEqualTo("original");
        assertThat(persisted.getDescription()).isNull();
        assertThat(internal.emitted).isEmpty(); assertThat(internal.changed).isEmpty();
        assertThat(sent).isEmpty(); assertThat(changesSent).isEmpty();
        service.updateRoom(room, new UpdateRoomRequest("original", "Admin edit"), adminUser);
        assertThat(rooms.findById(room).orElseThrow().getDescription()).isEqualTo("Admin edit");
        assertThat(sent).isEmpty(); assertThat(internal.emitted).isEmpty();
        assertRoomUpdated(owner, member, adminUser);
    }

    private void assertEvent(int index, RoomTimelineType type, UUID actor, UUID target,
            RoleName role, RoleName previousRole, String name, String previousName) {
        var event = internal.emitted.get(index);
        assertThat(event.type()).isEqualTo(type);
        assertThat(event.roomId()).isEqualTo(room).isPositive();
        assertThat(event.actorId()).isEqualTo(actor);
        assertThat(event.targetId()).isEqualTo(target);
        assertThat(event.role()).isEqualTo(role);
        assertThat(event.previousRole()).isEqualTo(previousRole);
        assertThat(event.name()).isEqualTo(name);
        assertThat(event.previousName()).isEqualTo(previousName);
        assertThat(event.version()).isEqualTo(1);
        assertThat(event.eventId()).isNotNull();
        assertThat(event.eventId().version()).isEqualTo(4);
        assertThat(event.occurredAt()).isBetween(before, Instant.now());
        assertThat(sent.get(index)).isEqualTo(RoomTimelineMessage.from(event));
    }

    @Test
    void creationJoinRoleAndRenameCaptureAllFieldsBeforeManagedEntityMutation() {
        assertEvent(0, RoomTimelineType.ROOM_CREATED, owner, null, null, null, "original", null);
        UUID member = UUID.randomUUID();
        service.addMember(room, owner, member);
        assertEvent(1, RoomTimelineType.MEMBER_JOINED, owner, member, null, null, null, null);
        service.updateMemberRole(room, member, RoleName.ADMIN, owner);
        assertEvent(2, RoomTimelineType.ROLE_CHANGED, owner, member, RoleName.ADMIN, RoleName.MEMBER, null, null);
        service.updateMemberRole(room, member, RoleName.MEMBER, owner);
        assertEvent(3, RoomTimelineType.ROLE_CHANGED, owner, member, RoleName.MEMBER, RoleName.ADMIN, null, null);
        service.updateRoom(room, new UpdateRoomRequest("renamed", null), owner);
        assertEvent(4, RoomTimelineType.ROOM_RENAMED, owner, null, null, null, "renamed", "original");
        assertThat(internal.emitted).extracting(RoomTimelineEvent::eventId).doesNotHaveDuplicates();
        assertThat(sent).hasSize(5);
    }

    @Test
    void nullablePreviousNameIsPreserved() {
        new TransactionTemplate(manager).executeWithoutResult(status -> rooms.findById(room).orElseThrow().setName(null));
        clear();
        service.updateRoom(room, new UpdateRoomRequest("named", null), owner);
        assertEvent(0, RoomTimelineType.ROOM_RENAMED, owner, null, null, null, "named", null);
    }

    @Test
    void adminKickAndAuthorizedSelfRemovalKeepActors() {
        UUID adminUser = add(RoleName.ADMIN);
        UUID target = add(RoleName.MEMBER);
        service.removeMember(room, adminUser, target);
        assertEvent(0, RoomTimelineType.MEMBER_KICKED, adminUser, target, null, null, null, null);
        service.removeMember(room, adminUser, adminUser);
        assertEvent(1, RoomTimelineType.MEMBER_LEFT, adminUser, adminUser, null, null, null, null);
        assertThat(sent).hasSize(2);
    }

    @Test
    void voluntaryMemberDeparture() {
        UUID user = add(RoleName.MEMBER);
        service.leaveRoom(room, user);
        assertEvent(0, RoomTimelineType.MEMBER_LEFT, user, user, null, null, null, null);
        assertThat(sent).hasSize(1);
    }

    @Test
    void ownerDeparturePreservesSendOrderAndSuccessorsActualPreviousRole() {
        for (RoleName previous : List.of(RoleName.ADMIN, RoleName.MEMBER)) {
            if (previous == RoleName.MEMBER) room = service.createRoom(new CreateRoomRequest("another", null), owner).id();
            UUID successor = add(previous);
            service.leaveRoom(room, owner);
            assertEvent(0, RoomTimelineType.MEMBER_LEFT, owner, owner, null, null, null, null);
            assertEvent(1, RoomTimelineType.OWNERSHIP_TRANSFERRED, owner, successor, RoleName.OWNER, previous, null, null);
            assertThat(sent).extracting(RoomTimelineMessage::type).containsExactly(
                    RoomTimelineType.MEMBER_LEFT, RoomTimelineType.OWNERSHIP_TRANSFERRED);
            assertThat(internal.emitted).extracting(RoomTimelineEvent::eventId).doesNotHaveDuplicates();
        }
    }

    @Test
    void finalDepartureAndExplicitDeletionHaveNoTimeline() {
        clear(); service.leaveRoom(room, owner);
        assertThat(sent).isEmpty(); assertThat(internal.emitted).isEmpty();
        room = service.createRoom(new CreateRoomRequest("delete", null), owner).id();
        clear(); service.deleteRoom(room);
        assertThat(sent).isEmpty(); assertThat(internal.emitted).isEmpty();
    }

    @Test
    void readsLookupsAndDmMutationsProduceNoTimeline() {
        clear();
        service.markRoomAsRead(room, owner);
        service.getRoomById(room, owner); service.getMembersByRoomId(room, owner);
        service.getRolesByRoomId(room, owner); service.getRoomsByUserId(owner);
        service.findRoleInRoom(room, owner); service.isUserInRoom(room, owner);
        UUID target = UUID.randomUUID();
        long dm = service.createDirectMessageRoom(owner, target).id();
        service.createDirectMessageRoom(owner, target);
        service.getDirectMessageRoomsByUserId(owner);
        service.updateRoom(dm, new UpdateRoomRequest("private", null), owner);
        service.markRoomAsRead(dm, owner);
        service.leaveRoom(dm, target);
        service.deleteRoom(dm);
        assertThat(sent).isEmpty(); assertThat(internal.emitted).isEmpty();
    }

    @Test
    void rejectedOperationsIncludingUnauthorizedSelfRemovalEmitNothing() {
        UUID member = add(RoleName.MEMBER);
        assertThatThrownBy(() -> service.removeMember(room, member, member)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.removeMember(room, member, owner)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.addMember(room, member, UUID.randomUUID())).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.updateRoom(room, new UpdateRoomRequest("bad", null), member)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.updateMemberRole(room, member, RoleName.ADMIN, member)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.updateMemberRole(room, member, RoleName.MEMBER, owner)).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> service.updateRoom(room, new UpdateRoomRequest("original", null), owner)).isInstanceOf(BadRequestException.class);
        assertThat(sent).isEmpty(); assertThat(internal.emitted).isEmpty();
    }

    @Test
    void internalEventsCanPrecedeRollbackButExternalSendWaitsForCommit() {
        UUID successor = add(RoleName.ADMIN);
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            service.leaveRoom(room, owner);
            assertThat(internal.emitted).hasSize(2);
            assertThat(sent).isEmpty();
            status.setRollbackOnly();
        });
        assertThat(sent).isEmpty();
        assertThat(service.findRoleInRoom(room, successor)).contains(RoleName.ADMIN);
        assertThat(service.findRoleInRoom(room, owner)).contains(RoleName.OWNER);
        clear();
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            service.updateRoom(room, new UpdateRoomRequest("committed", null), owner);
            assertThat(internal.emitted).hasSize(1);
            assertThat(sent).isEmpty();
        });
        assertThat(sent).hasSize(1);
        assertEvent(0, RoomTimelineType.ROOM_RENAMED, owner, null, null, null, "committed", "original");
    }

    @Test
    void noNontransactionalFallback() {
        clear(); clearInvocations(admin);
        events.publishEvent(new RoomTimelineEvent(UUID.randomUUID(), 1, RoomTimelineType.MEMBER_LEFT,
                room, owner, owner, null, null, null, null, Instant.now()));
        assertThat(internal.emitted).hasSize(1);
        assertThat(sent).isEmpty();
        verifyNoInteractions(admin);
    }
}
