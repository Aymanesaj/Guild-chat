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
import java.util.Map;
import java.util.Optional;
import java.util.stream.LongStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.repository.ReadStateStore;

@ExtendWith(MockitoExtension.class)
class ReadStateServiceTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final Long ROOM = 42L;
    private static final String MESSAGE_ID = "66f0c1a2b3c4d5e6f7a8b9c0";
    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    @Mock
    private ReadStateStore store;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private OrgClient orgClient;
    @Mock
    private ApplicationEventPublisher events;

    private ReadStateService service;

    @BeforeEach
    void setUp() {
        service = new ReadStateService(store, messageRepository, orgClient, Clock.fixed(NOW, ZoneOffset.UTC), events);
    }

    private static Message messageIn(long roomId) {
        return Message.create(roomId, BOB, null, "hi", "text", NOW);
    }

    private static void assertApiError(Runnable call, HttpStatus status, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(status);
                    assertThat(e.getCode()).isEqualTo(code);
                });
    }

    @Test
    @DisplayName("markRead stores the mark, returns what is still unread and tells the user's sockets")
    void marksRead() {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(messageIn(ROOM)));
        when(store.markRead(ALICE, ROOM, MESSAGE_ID, NOW)).thenReturn(MESSAGE_ID);
        when(store.unreadCount(ALICE, ROOM, MESSAGE_ID)).thenReturn(0);

        ReadStateService.ReadMark read = service.markRead(ALICE, ROOM, MESSAGE_ID);

        assertThat(read).isEqualTo(new ReadStateService.ReadMark(ROOM, MESSAGE_ID, 0));
        verify(events).publishEvent(new RoomReadEvent(ALICE, read));
    }

    @Test
    @DisplayName("a non-member is refused before anything else")
    void nonMemberIsRefusedFirst() {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(false);

        assertApiError(() -> service.markRead(ALICE, ROOM, "not-an-id"), HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        verifyNoInteractions(store, messageRepository, events);
    }

    @Test
    @DisplayName("a malformed message id is a 400")
    void malformedId() {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);

        assertApiError(() -> service.markRead(ALICE, ROOM, "nope"), HttpStatus.BAD_REQUEST, "INVALID_MESSAGE_ID");
        verifyNoInteractions(store);
    }

    @Test
    @DisplayName("an unknown message, or one from another room, is a 404 and moves nothing")
    void messageMustBeInTheRoom() {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.empty(), Optional.of(messageIn(99L)));

        assertApiError(() -> service.markRead(ALICE, ROOM, MESSAGE_ID), HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND");
        assertApiError(() -> service.markRead(ALICE, ROOM, MESSAGE_ID), HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND");
        verify(store, never()).markRead(any(), any(), any(), any());
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("unreadCounts leaves out rooms the user is not in, in the order asked")
    void countsOnlyMemberRooms() {
        when(orgClient.isMember(ALICE, 3L)).thenReturn(true);
        when(orgClient.isMember(ALICE, 5L)).thenReturn(false);
        when(orgClient.isMember(ALICE, 7L)).thenReturn(true);
        when(store.lastRead(ALICE, List.of(3L, 7L))).thenReturn(Map.of(3L, MESSAGE_ID));
        when(store.unreadCount(ALICE, 3L, MESSAGE_ID)).thenReturn(2);
        when(store.unreadCount(ALICE, 7L, null)).thenReturn(0);

        assertThat(service.unreadCounts(ALICE, List.of(3L, 5L, 7L, 3L)))
                .containsExactly(Map.entry(3L, 2), Map.entry(7L, 0));
    }

    @Test
    @DisplayName("unreadCounts needs 1 to 100 room ids")
    void validatesIds() {
        assertApiError(() -> service.unreadCounts(ALICE, null), HttpStatus.BAD_REQUEST, "MISSING_IDS");
        assertApiError(() -> service.unreadCounts(ALICE, List.of()), HttpStatus.BAD_REQUEST, "MISSING_IDS");
        List<Long> tooMany = LongStream.rangeClosed(1, 101).boxed().toList();
        assertApiError(() -> service.unreadCounts(ALICE, tooMany), HttpStatus.BAD_REQUEST, "TOO_MANY_IDS");
        verifyNoInteractions(orgClient, store);
    }

    @Test
    @DisplayName("no room the user is in: an empty answer, without asking the store")
    void noMemberRooms() {
        when(orgClient.isMember(ALICE, 5L)).thenReturn(false);

        assertThat(service.unreadCounts(ALICE, List.of(5L))).isEmpty();
        verifyNoInteractions(store);
    }
}
