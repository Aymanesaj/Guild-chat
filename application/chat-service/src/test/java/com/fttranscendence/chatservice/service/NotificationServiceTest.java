package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.repository.NotificationStore;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final String FRIENDSHIP = "0f8fad5b-d9cb-469f-a165-70867728950e";
    private static final String EVENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    private static final String ID = "66f0c1a2b3c4d5e6f7a8b9c0";
    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    @Mock
    private NotificationStore store;
    @Mock
    private ApplicationEventPublisher events;

    private NotificationService service;

    @BeforeEach
    void setUp() {
        service = new NotificationService(store, Clock.fixed(NOW, ZoneOffset.UTC), events);
    }

    /** The stored copy, as insert returns it. */
    private void storesAs(String id) {
        when(store.insert(any())).thenAnswer(call -> {
            Notification n = call.getArgument(0);
            return Optional.of(new Notification(id, n.userId(), n.type(), n.actorId(), n.roomId(), n.role(),
                    n.friendshipId(), n.sourceId(), n.createdAt(), null));
        });
    }

    private Notification stored() {
        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(store).insert(captor.capture());
        return captor.getValue();
    }

    private static Message roomEvent(String type, String actor, String target, String role) {
        Message message = Message.system(42L, "event-" + type,
                new SystemEvent(type, actor, target, role, null, null, null), NOW);
        ReflectionTestUtils.setField(message, "id", ID);
        return message;
    }

    private static void assertApiError(Runnable call, HttpStatus status, String code) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getStatus()).isEqualTo(status);
            assertThat(e.getCode()).isEqualTo(code);
        });
    }

    @Test
    @DisplayName("a friend request notifies the addressee, with the requester as actor")
    void friendRequestNotifiesAddressee() {
        storesAs(ID);

        service.friendRequestSent(EVENT, FRIENDSHIP, ALICE, BOB);

        assertThat(stored()).isEqualTo(Notification.of(BOB, Notification.FRIEND_REQUEST, ALICE, null, null,
                FRIENDSHIP, EVENT, NOW));
        verify(events).publishEvent(any(NotificationCreatedEvent.class));
    }

    @Test
    @DisplayName("an accepted request notifies the requester, with the addressee as actor")
    void acceptedNotifiesRequester() {
        storesAs(ID);

        service.friendRequestAccepted(EVENT, FRIENDSHIP, ALICE, BOB);

        assertThat(stored()).isEqualTo(Notification.of(ALICE, Notification.FRIEND_ACCEPTED, BOB, null, null,
                FRIENDSHIP, EVENT, NOW));
    }

    @Test
    @DisplayName("a duplicate source is not announced again")
    void duplicateIsNotAnnounced() {
        when(store.insert(any())).thenReturn(Optional.empty());

        service.friendRequestSent(EVENT, FRIENDSHIP, ALICE, BOB);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("a storage failure is swallowed: the event that caused it must not fail")
    void storageFailureIsSwallowed() {
        when(store.insert(any())).thenThrow(new DataAccessResourceFailureException("mongo down"));

        service.friendRequestSent(EVENT, FRIENDSHIP, ALICE, BOB);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("room events notify their target: added, removed, role changed, made owner")
    void roomEventsNotifyTheTarget() {
        storesAs(ID);

        service.onMessageCreated(new MessageCreatedEvent(roomEvent("MEMBER_JOINED", ALICE, BOB, null)));
        service.onMessageCreated(new MessageCreatedEvent(roomEvent("MEMBER_KICKED", ALICE, BOB, null)));
        service.onMessageCreated(new MessageCreatedEvent(roomEvent("ROLE_CHANGED", ALICE, BOB, "ADMIN")));
        service.onMessageCreated(new MessageCreatedEvent(roomEvent("OWNERSHIP_TRANSFERRED", ALICE, BOB, null)));

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(store, org.mockito.Mockito.times(4)).insert(captor.capture());
        assertThat(captor.getAllValues())
                .extracting(Notification::userId, Notification::type, Notification::actorId,
                        Notification::roomId, Notification::role, Notification::sourceId)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(BOB, "ROOM_ADDED", ALICE, 42L, null, ID),
                        org.assertj.core.groups.Tuple.tuple(BOB, "ROOM_REMOVED", ALICE, 42L, null, ID),
                        org.assertj.core.groups.Tuple.tuple(BOB, "ROLE_CHANGED", ALICE, 42L, "ADMIN", ID),
                        org.assertj.core.groups.Tuple.tuple(BOB, "ROLE_CHANGED", ALICE, 42L, "OWNER", ID));
    }

    @ParameterizedTest
    @ValueSource(strings = { "MEMBER_LEFT", "ROOM_CREATED", "ROOM_RENAMED", "SOMETHING_NEW" })
    @DisplayName("events that happen to nobody else notify nobody")
    void otherEventsNotifyNobody(String type) {
        service.onMessageCreated(new MessageCreatedEvent(roomEvent(type, ALICE, BOB, null)));

        verifyNoInteractions(store, events);
    }

    @Test
    @DisplayName("no notification for what you did to yourself, nor for ordinary messages")
    void selfActionsAndMessagesNotifyNobody() {
        service.onMessageCreated(new MessageCreatedEvent(roomEvent("MEMBER_JOINED", ALICE, ALICE, null)));
        service.onMessageCreated(new MessageCreatedEvent(Message.create(42L, ALICE, null, "hi", "text", NOW)));

        verify(store, never()).insert(any());
    }

    @Test
    @DisplayName("list checks limit and cursor")
    void listValidates() {
        assertApiError(() -> service.list(ALICE, null, 0), HttpStatus.BAD_REQUEST, "INVALID_LIMIT");
        assertApiError(() -> service.list(ALICE, null, 51), HttpStatus.BAD_REQUEST, "INVALID_LIMIT");
        assertApiError(() -> service.list(ALICE, "nope", null), HttpStatus.BAD_REQUEST, "INVALID_CURSOR");
        verifyNoInteractions(store);

        service.list(ALICE, ID, null);
        verify(store).page(ALICE, ID, NotificationService.DEFAULT_LIMIT);
    }

    @Test
    @DisplayName("markRead checks the ids, then reports what is left unread to every tab")
    void markRead() {
        assertApiError(() -> service.markRead(ALICE, null), HttpStatus.BAD_REQUEST, "MISSING_IDS");
        assertApiError(() -> service.markRead(ALICE, List.of("bad")), HttpStatus.BAD_REQUEST, "INVALID_NOTIFICATION_ID");
        List<String> tooMany = IntStream.range(0, 101).mapToObj(i -> String.format("%024x", i)).toList();
        assertApiError(() -> service.markRead(ALICE, tooMany), HttpStatus.BAD_REQUEST, "TOO_MANY_IDS");
        verifyNoInteractions(store);

        when(store.unreadCount(ALICE)).thenReturn(4);
        NotificationService.ReadResult read = service.markRead(ALICE, List.of(ID, ID));

        verify(store).markRead(ALICE, List.of(ID), NOW);
        assertThat(read).isEqualTo(new NotificationService.ReadResult(List.of(ID), false, 4));
        verify(events).publishEvent(new NotificationsReadEvent(ALICE, read));
    }

    @Test
    @DisplayName("markAllRead marks everything and announces it")
    void markAllRead() {
        NotificationService.ReadResult read = service.markAllRead(ALICE);

        verify(store).markAllRead(ALICE, NOW);
        assertThat(read).isEqualTo(new NotificationService.ReadResult(null, true, 0));
        verify(events).publishEvent(new NotificationsReadEvent(ALICE, read));
    }
}
