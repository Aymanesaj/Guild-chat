package com.ft_transcendence.orgservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.ft_transcendence.orgservice.messaging.RoomEventPublisher;
import com.ft_transcendence.orgservice.client.IdentityGrpcClient;
import com.ft_transcendence.orgservice.dto.CreateRoomRequest;
import com.ft_transcendence.orgservice.dto.UpdateRoomRequest;
import com.ft_transcendence.orgservice.exception.ForbiddenException;
import com.ft_transcendence.orgservice.exception.NotFoundException;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Real transactions, SQL constraints and row locks; no HTTP/gRPC servers. */
@SpringBootTest(classes = RoomOwnershipIntegrationTest.Config.class, properties = {
        "spring.datasource.url=${ownership.test.database-url:jdbc:h2:mem:ownership;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=5000}",
        "spring.datasource.driver-class-name=${ownership.test.database-driver:org.h2.Driver}",
        "spring.datasource.username=${ownership.test.database-user:sa}",
        "spring.datasource.password=${ownership.test.database-password:}",
        "spring.jpa.open-in-view=false"
})
class RoomOwnershipIntegrationTest {
    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    @EntityScan(basePackageClasses = Room.class)
    @EnableJpaRepositories(basePackageClasses = RoomRepository.class)
    @Import({RoomService.class, DirectMessageCreationService.class, RoomEventPublisher.class})
    static class Config {}

    @org.springframework.test.context.bean.override.mockito.MockitoBean
    org.springframework.amqp.rabbit.core.RabbitTemplate rabbit;
    @org.springframework.test.context.bean.override.mockito.MockitoBean
    org.springframework.amqp.rabbit.core.RabbitAdmin admin;
    @Autowired RoomService service;
    @Autowired RoomRepository rooms;
    @Autowired RoomMemberRepository members;
    @Autowired RoleRepository roles;
    @Autowired MemberRoleRepository assignments;
    @Autowired PlatformTransactionManager transactionManager;
    @MockitoBean IdentityGrpcClient identity;
    @MockitoSpyBean RoomEventPublisher notifications;

    private final List<RoomChangedEvent> delivered = new CopyOnWriteArrayList<>();
    private TransactionTemplate tx;
    private UUID owner;
    private long room;

    @BeforeEach
    void setup() {
        tx = new TransactionTemplate(transactionManager);
        // Keep the real @TransactionalEventListener registration, replacing only
        // its network body. Calls here prove the production AFTER_COMMIT boundary.
        doAnswer(call -> { delivered.add(call.getArgument(0)); return null; })
                .when(notifications).onRoomChanged(any());
        when(identity.userExists(any())).thenReturn(true);
        owner = UUID.randomUUID();
        room = service.createRoom(new CreateRoomRequest("ownership", null), owner).id();
        delivered.clear();
    }

    @Test
    void dmVisibilityPersistsWithoutChangingRoomMembershipOrRoles() {
        UUID peer = UUID.randomUUID();
        long dm = service.createDirectMessageRoom(owner, peer).id();
        long membershipCount = members.count();
        long roleCount = assignments.count();
        delivered.clear();

        service.hideDirectMessage(dm, owner);
        service.hideDirectMessage(dm, owner);
        assertThat(members.findByRoomIdAndUserId(dm, owner).orElseThrow().getHiddenAt()).isNotNull();
        assertThat(members.findByRoomIdAndUserId(dm, peer).orElseThrow().getHiddenAt()).isNull();
        assertThat(service.getDirectMessageRoomsByUserId(owner)).extracting(r -> r.id()).doesNotContain(dm);
        assertThat(service.getDirectMessageRoomsByUserId(peer)).extracting(r -> r.id()).contains(dm);
        assertThat(delivered).singleElement().satisfies(event -> {
            assertThat(event.change()).isEqualTo(RoomChange.ROOM_REMOVED);
            assertThat(event.userIds()).containsExactly(owner);
        });
        delivered.clear();

        assertThat(service.createDirectMessageRoom(owner, peer).id()).isEqualTo(dm);
        assertThat(service.createDirectMessageRoom(owner, peer).id()).isEqualTo(dm);
        assertThat(members.findByRoomIdAndUserId(dm, owner).orElseThrow().getHiddenAt()).isNull();
        assertThat(delivered).singleElement().satisfies(event -> {
            assertThat(event.change()).isEqualTo(RoomChange.ROOM_ADDED);
            assertThat(event.userIds()).containsExactly(owner);
        });

        service.hideDirectMessage(dm, owner);
        service.hideDirectMessage(dm, peer);
        delivered.clear();
        service.revealDm(dm, peer);
        service.revealDm(dm, peer);
        assertThat(members.findByRoomId(dm)).allSatisfy(member -> assertThat(member.getHiddenAt()).isNull());
        assertThat(delivered).singleElement().satisfies(event -> {
            assertThat(event.change()).isEqualTo(RoomChange.ROOM_ADDED);
            assertThat(event.userIds()).containsExactlyInAnyOrder(owner, peer);
        });
        assertThat(members.count()).isEqualTo(membershipCount);
        assertThat(assignments.count()).isEqualTo(roleCount);
        assertThat(rooms.findById(dm)).isPresent();
    }

    @Test
    void descriptionPersistsAndIsReturnedByRoomEndpoints() {
        String description = "d".repeat(500);
        var created = service.createRoom(new CreateRoomRequest("described", description), owner);
        assertThat(created.description()).isEqualTo(description);
        assertThat(rooms.findById(created.id()).orElseThrow().getDescription()).isEqualTo(description);
        assertThat(service.getRoomById(created.id(), owner).description()).isEqualTo(description);
        assertThat(service.getRoomsByUserId(owner)).anySatisfy(response -> {
            assertThat(response.id()).isEqualTo(created.id());
            assertThat(response.description()).isEqualTo(description);
        });

        var updated = service.updateRoom(created.id(), new UpdateRoomRequest("described", "Updated"), owner);
        assertThat(updated.description()).isEqualTo("Updated");
        assertThat(rooms.findById(created.id()).orElseThrow().getDescription()).isEqualTo("Updated");
        service.updateRoom(created.id(), new UpdateRoomRequest("renamed", null), owner);
        assertThat(service.getRoomById(created.id(), owner).description()).isEqualTo("Updated");
        service.updateRoom(created.id(), new UpdateRoomRequest("renamed", ""), owner);
        assertThat(service.getRoomById(created.id(), owner).description()).isEmpty();
    }

    @Test
    void roomsWithoutDescriptionsContinueToWork() {
        assertThat(service.getRoomById(room, owner).description()).isNull();
        service.updateRoom(room, new UpdateRoomRequest("renamed", null), owner);
        assertThat(service.getRoomById(room, owner).description()).isNull();
        service.updateRoom(room, new UpdateRoomRequest("renamed", "Added later"), owner);
        assertThat(service.getRoomById(room, owner).description()).isEqualTo("Added later");
    }

    @Test
    void descriptionEditsKeepExistingRoomPermissions() {
        UUID member = add(RoleName.MEMBER);
        UUID admin = add(RoleName.ADMIN);
        assertThatThrownBy(() -> service.updateRoom(room,
                new UpdateRoomRequest("ownership", "Forbidden"), member))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.updateRoom(room,
                new UpdateRoomRequest("ownership", "Forbidden"), UUID.randomUUID()))
                .isInstanceOf(NotFoundException.class);
        assertThat(service.getRoomById(room, owner).description()).isNull();
        service.updateRoom(room, new UpdateRoomRequest("ownership", "Admin edit"), admin);
        assertThat(service.getRoomById(room, owner).description()).isEqualTo("Admin edit");
    }

    @Test
    void descriptionValidationAllowsNullAnd500ButRejects501Characters() {
        try (var factory = jakarta.validation.Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            for (String description : java.util.Arrays.asList(null, "", "d".repeat(500))) {
                assertThat(validator.validate(new CreateRoomRequest("room", description))).isEmpty();
                assertThat(validator.validate(new UpdateRoomRequest("room", description))).isEmpty();
            }
            assertThat(validator.validate(new CreateRoomRequest("room", "d".repeat(501))))
                    .anySatisfy(violation -> assertThat(violation.getPropertyPath().toString()).isEqualTo("description"));
            assertThat(validator.validate(new UpdateRoomRequest("room", "d".repeat(501))))
                    .anySatisfy(violation -> assertThat(violation.getPropertyPath().toString()).isEqualTo("description"));
        }
        assertThatThrownBy(() -> service.createRoom(
                new CreateRoomRequest("too long", "d".repeat(501)), owner))
                .isInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThatThrownBy(() -> service.updateRoom(room,
                new UpdateRoomRequest("ownership", "d".repeat(501)), owner))
                .hasRootCauseInstanceOf(jakarta.validation.ConstraintViolationException.class);
        assertThat(service.getRoomById(room, owner).description()).isNull();
    }

    @Test
    void newDmPublishesOnceAfterItsOwnTransactionAndExistingLookupPublishesNothing() {
        UUID target = UUID.randomUUID();
        long dm = service.createDirectMessageRoom(owner, target).id();
        assertThat(delivered).containsExactly(
                new RoomChangedEvent(dm, RoomChange.ROOM_ADDED, Set.of(owner, target)));
        delivered.clear();
        assertThat(service.createDirectMessageRoom(target, owner).id()).isEqualTo(dm);
        assertThat(delivered).isEmpty();
    }

    @Test
    void dmCreationInRolledBackTransactionPublishesNothing() {
        UUID target = UUID.randomUUID();
        tx.executeWithoutResult(status -> {
            service.createDirectMessageRoom(owner, target);
            assertThat(delivered).isEmpty();
            status.setRollbackOnly();
        });
        assertThat(delivered).isEmpty();
        long dm = service.createDirectMessageRoom(owner, target).id();
        assertThat(delivered).containsExactly(
                new RoomChangedEvent(dm, RoomChange.ROOM_ADDED, Set.of(owner, target)));
    }

    private UUID add(RoleName role) {
        UUID user = UUID.randomUUID();
        service.addMember(room, owner, user);
        if (role == RoleName.ADMIN) service.updateMemberRole(room, user, role, owner);
        delivered.clear();
        return user;
    }

    private void assertOwner(UUID user) {
        assertThat(service.findRoleInRoom(room, user)).contains(RoleName.OWNER);
        tx.executeWithoutResult(status -> assertThat(assignments.findByRoomMemberRoomId(room)
                .stream().filter(a -> a.getRole().getName() == RoleName.OWNER).toList()).hasSize(1));
    }

    private void assertDeparture(UUID leaver, UUID... remaining) {
        assertThat(delivered).containsExactly(
                new RoomChangedEvent(room, RoomChange.ROOM_REMOVED, Set.of(leaver)),
                new RoomChangedEvent(room, RoomChange.ROOM_UPDATED, Set.of(remaining)));
        assertThat(members.findByRoomIdAndUserId(room, leaver)).isEmpty();
        tx.executeWithoutResult(status -> assertThat(assignments.findByRoomMemberRoomId(room))
                .noneMatch(a -> a.getRoomMember().getUserId().equals(leaver)));
    }

    @Test
    void adminWinsOverEarlierRegularMemberAndLowestAdminIdWins() {
        UUID regular = add(RoleName.MEMBER);
        UUID firstAdmin = add(RoleName.ADMIN);
        UUID secondAdmin = add(RoleName.ADMIN);
        service.leaveRoom(room, owner);
        assertOwner(firstAdmin);
        assertDeparture(owner, regular, firstAdmin, secondAdmin);
    }

    @Test
    void lowestMembershipIdWinsAmongRegularMembers() {
        UUID first = add(RoleName.MEMBER);
        UUID second = add(RoleName.MEMBER);
        service.leaveRoom(room, owner);
        assertOwner(first);
        assertDeparture(owner, first, second);
    }

    @Test
    void onlyOtherMemberBecomesOwner() {
        UUID other = add(RoleName.MEMBER);
        service.leaveRoom(room, owner);
        assertOwner(other);
        assertDeparture(owner, other);
    }

    @Test
    void lastOwnerDeletesRoomRolesAndMembership() {
        service.leaveRoom(room, owner);
        assertThat(rooms.existsById(room)).isFalse();
        assertThat(members.findByRoomId(room)).isEmpty();
        assertThat(roles.findByRoomId(room)).isEmpty();
        assertThat(assignments.findByRoomMemberRoomId(room)).isEmpty();
        assertThat(delivered).containsExactly(
                new RoomChangedEvent(room, RoomChange.ROOM_REMOVED, Set.of(owner)),
                new RoomChangedEvent(room, RoomChange.ROOM_REMOVED, Set.of(), true));
    }

    @Test
    void adminCannotKickOwner() {
        UUID admin = add(RoleName.ADMIN);
        assertThatThrownBy(() -> service.removeMember(room, admin, owner))
                .isInstanceOf(ForbiddenException.class);
        assertOwner(owner);
        assertThat(members.findByRoomId(room)).hasSize(2);
        assertThat(delivered).isEmpty();
    }

    @Test
    void ordinaryDepartureAndKickKeepOwnerAndNotificationRecipients() {
        UUID leaver = add(RoleName.MEMBER);
        UUID kicked = add(RoleName.MEMBER);
        service.leaveRoom(room, leaver);
        assertDeparture(leaver, owner, kicked);
        assertOwner(owner);
        delivered.clear();
        service.removeMember(room, owner, kicked);
        assertDeparture(kicked, owner);
        assertOwner(owner);
    }

    @Test
    void promotionAndRemovalRollbackTogetherAndSendNothing() {
        UUID successor = add(RoleName.ADMIN);
        tx.executeWithoutResult(status -> {
            service.leaveRoom(room, owner);
            assertThat(service.findRoleInRoom(room, successor)).contains(RoleName.OWNER);
            assertThat(members.findByRoomIdAndUserId(room, owner)).isEmpty();
            assertThat(delivered).isEmpty();
            status.setRollbackOnly();
        });
        assertOwner(owner);
        assertThat(service.findRoleInRoom(room, successor)).contains(RoleName.ADMIN);
        assertThat(members.findByRoomIdAndUserId(room, owner)).isPresent();
        assertThat(delivered).isEmpty();
    }

    @Test
    void databaseFailureRollsBackPromotionAndRemoval() {
        UUID successor = add(RoleName.MEMBER);
        // A real database uniqueness failure after the service has promoted and removed
        // the owner must roll back the whole surrounding transaction.
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            service.leaveRoom(room, owner);
            Role invalid = new Role();
            invalid.setName(RoleName.ADMIN);
            invalid.setRoom(rooms.getReferenceById(room));
            roles.saveAndFlush(invalid);
        })).isInstanceOf(DataIntegrityViolationException.class);
        assertOwner(owner);
        assertThat(service.findRoleInRoom(room, successor)).contains(RoleName.MEMBER);
        assertThat(delivered).isEmpty();
    }

    @Test
    void notificationsWaitForCommit() {
        UUID successor = add(RoleName.MEMBER);
        tx.executeWithoutResult(status -> {
            service.leaveRoom(room, owner);
            assertThat(delivered).isEmpty();
        });
        assertDeparture(owner, successor);
    }

    /** Holds the first operation's transaction open while the second contends.
     * The second must actually wait on the room lock, then reread committed state.
     */
    private void contend(Runnable first, Runnable second) throws Exception {
        try (var executor = Executors.newFixedThreadPool(2)) {
            CountDownLatch changed = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            CountDownLatch started = new CountDownLatch(1);
            var firstResult = executor.submit(() -> tx.executeWithoutResult(status -> {
                first.run();
                changed.countDown();
                await(release);
            }));
            try {
                assertThat(changed.await(5, TimeUnit.SECONDS)).isTrue();
                var secondResult = executor.submit(() -> {
                    started.countDown();
                    second.run();
                });
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> secondResult.get(200, TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
                release.countDown();
                firstResult.get(5, TimeUnit.SECONDS);
                secondResult.get(5, TimeUnit.SECONDS);
            } finally {
                release.countDown();
            }
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Timed out waiting for transaction");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    @Test
    void concurrentOwnerAndSuccessorDeparturesTransferAgain() throws Exception {
        UUID admin = add(RoleName.ADMIN);
        UUID regular = add(RoleName.MEMBER);
        contend(() -> service.leaveRoom(room, owner), () -> service.leaveRoom(room, admin));
        assertOwner(regular);
        assertThat(members.findByRoomId(room)).extracting(RoomMember::getUserId).containsExactly(regular);
    }

    @Test
    void concurrentLastTwoDeparturesDeleteRoom() throws Exception {
        UUID other = add(RoleName.MEMBER);
        contend(() -> service.leaveRoom(room, owner), () -> service.leaveRoom(room, other));
        assertThat(rooms.existsById(room)).isFalse();
        assertThat(assignments.findByRoomMemberRoomId(room)).isEmpty();
    }

    @Test
    void concurrentCandidateDepartureIsExcludedFromSelection() throws Exception {
        UUID admin = add(RoleName.ADMIN);
        UUID regular = add(RoleName.MEMBER);
        contend(() -> service.leaveRoom(room, admin), () -> service.leaveRoom(room, owner));
        assertOwner(regular);
    }

    @Test
    void concurrentKickOfCandidateIsExcludedFromSelection() throws Exception {
        UUID admin = add(RoleName.ADMIN);
        UUID regular = add(RoleName.MEMBER);
        contend(() -> service.removeMember(room, owner, admin), () -> service.leaveRoom(room, owner));
        assertOwner(regular);
    }

    @Test
    void concurrentKickCannotRemoveNewOwner() throws Exception {
        UUID admin = add(RoleName.ADMIN);
        UUID otherAdmin = add(RoleName.ADMIN);
        contend(() -> service.leaveRoom(room, owner), () ->
                assertThatThrownBy(() -> service.removeMember(room, otherAdmin, admin))
                        .isInstanceOf(ForbiddenException.class));
        assertOwner(admin);
    }

    @Test
    void concurrentDemotionChangesSuccessorPriority() throws Exception {
        UUID regular = add(RoleName.MEMBER);
        UUID admin = add(RoleName.ADMIN);
        contend(() -> service.updateMemberRole(room, admin, RoleName.MEMBER, owner),
                () -> service.leaveRoom(room, owner));
        assertOwner(regular);
    }

    @Test
    void oldOwnerCannotChangeRolesAfterTransfer() throws Exception {
        UUID admin = add(RoleName.ADMIN);
        UUID regular = add(RoleName.MEMBER);
        contend(() -> service.leaveRoom(room, owner), () ->
                assertThatThrownBy(() -> service.updateMemberRole(room, regular, RoleName.ADMIN, owner))
                        .isInstanceOf(NotFoundException.class));
        assertOwner(admin);
        assertThat(service.findRoleInRoom(room, regular)).contains(RoleName.MEMBER);
    }

    @Test
    void concurrentAddBeforeOwnerDepartureProvidesSuccessor() throws Exception {
        UUID newcomer = UUID.randomUUID();
        contend(() -> service.addMember(room, owner, newcomer), () -> service.leaveRoom(room, owner));
        assertOwner(newcomer);
    }

    @Test
    void concurrentAddCannotResurrectDeletedRoom() throws Exception {
        contend(() -> service.leaveRoom(room, owner), () ->
                assertThatThrownBy(() -> service.addMember(room, owner, UUID.randomUUID()))
                        .isInstanceOf(NotFoundException.class));
        assertThat(rooms.existsById(room)).isFalse();
    }

    @Test
    void directMessageDepartureKeepsExistingMemberRules() {
        UUID other = UUID.randomUUID();
        long dm = tx.execute(status -> {
            Room direct = new Room();
            direct.setType(RoomType.DM);
            rooms.save(direct);
            Role memberRole = new Role();
            memberRole.setRoom(direct);
            memberRole.setName(RoleName.MEMBER);
            roles.save(memberRole);
            for (UUID user : List.of(owner, other)) {
                RoomMember member = new RoomMember();
                member.setRoom(direct);
                member.setUserId(user);
                members.save(member);
                MemberRole assignment = new MemberRole();
                assignment.setRoomMember(member);
                assignment.setRole(memberRole);
                assignments.save(assignment);
            }
            return direct.getId();
        });
        service.leaveRoom(dm, owner);
        assertThat(rooms.existsById(dm)).isTrue();
        assertThat(service.findRoleInRoom(dm, other)).contains(RoleName.MEMBER);
        assertThat(delivered).containsExactly(
                new RoomChangedEvent(dm, RoomChange.ROOM_REMOVED, Set.of(owner)),
                new RoomChangedEvent(dm, RoomChange.ROOM_UPDATED, Set.of(other)));
    }
}
