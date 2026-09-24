package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import org.bson.types.ObjectId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.Membership;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.repository.MessageRepository;

/**
 * Pure rules, no Spring and no database: which repository method is chosen,
 * how the limit is defaulted and capped, which inputs are rejected.
 */
@ExtendWith(MockitoExtension.class)
class MessageServiceTest {

    private static final long ROOM = 42L;
    private static final String CURSOR = new ObjectId().toHexString();
    private static final long OTHER_ROOM = 99L;

    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Mock
    private MessageRepository messageRepository;

    @Mock
    private OrgClient orgClient;

    @Mock
    private ApplicationEventPublisher events;

    /** Fixed so created_at can be asserted exactly, with no sleeping. */
    private static final Instant NOW = Instant.parse("2026-09-21T10:00:00Z");

    @org.mockito.Spy
    private Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

    @InjectMocks
    private MessageService messageService;

    private void isMember(boolean member) {
        when(orgClient.isMember(USER, ROOM)).thenReturn(member);
    }

    private Message message(String content) {
        return Message.create(ROOM, "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
                null, content, "text", Instant.now());
    }

    @Test
    @DisplayName("no cursor: reads the newest page with the default limit of 50")
    void newestPageUsesDefaultLimit() {
        isMember(true);
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any()))
                .thenReturn(List.of(message("hello")));

        List<Message> result = messageService.history(USER, ROOM, null, null);

        assertThat(result).hasSize(1);

        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(messageRepository).findByRoomIdOrderByIdDesc(eq(ROOM), limit.capture());
        assertThat(limit.getValue().max()).isEqualTo(MessageService.DEFAULT_LIMIT);

        verify(messageRepository, never())
                .findByRoomIdAndIdLessThanOrderByIdDesc(any(), any(), any());
    }

    @Test
    @DisplayName("blank cursor is treated as no cursor, not as a bad one")
    void blankCursorIsTreatedAsNoCursor() {
        isMember(true);
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any())).thenReturn(List.of());

        messageService.history(USER, ROOM, "   ", null);

        verify(messageRepository).findByRoomIdOrderByIdDesc(eq(ROOM), any());
    }

    @Test
    @DisplayName("with a cursor: reads the page before it, honouring the requested limit")
    void olderPageUsesCursorAndLimit() {
        isMember(true);
        when(messageRepository.findByRoomIdAndIdLessThanOrderByIdDesc(eq(ROOM), eq(CURSOR), any()))
                .thenReturn(List.of(message("older")));

        messageService.history(USER, ROOM, CURSOR, 10);

        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(messageRepository)
                .findByRoomIdAndIdLessThanOrderByIdDesc(eq(ROOM), eq(CURSOR), limit.capture());
        assertThat(limit.getValue().max()).isEqualTo(10);
    }

    @Test
    @DisplayName("a cursor that is not an ObjectId is a 400, not a 500 from the driver")
    void rejectsMalformedCursor() {
        isMember(true);
        assertThatThrownBy(() -> messageService.history(USER, ROOM, "not-an-object-id", null))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_CURSOR");
                });

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("limit above the maximum is rejected: ?limit=1000000 must not be a free DoS")
    void rejectsTooLargeLimit() {
        isMember(true);
        assertThatThrownBy(() -> messageService.history(USER, ROOM, null, MessageService.MAX_LIMIT + 1))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_LIMIT");
                });

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("limit of zero or negative is rejected")
    void rejectsNonPositiveLimit() {
        isMember(true);
        assertThatThrownBy(() -> messageService.history(USER, ROOM, null, 0))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> messageService.history(USER, ROOM, null, -5))
                .isInstanceOf(ApiException.class);

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("the maximum limit itself is allowed (boundary)")
    void acceptsTheMaximumLimit() {
        isMember(true);
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any())).thenReturn(List.of());

        messageService.history(USER, ROOM, null, MessageService.MAX_LIMIT);

        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(messageRepository).findByRoomIdOrderByIdDesc(eq(ROOM), limit.capture());
        assertThat(limit.getValue().max()).isEqualTo(MessageService.MAX_LIMIT);
    }

    @Test
    @DisplayName("a non-member gets 403, so an outsider cannot tell an empty room from a private one")
    void nonMemberIsForbidden() {
        isMember(false);

        assertThatThrownBy(() -> messageService.history(USER, ROOM, null, null))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("NOT_A_MEMBER");
                });
    }

    @Test
    @DisplayName("a non-member's request never reaches MongoDB: the check precedes the query")
    void nonMemberNeverTouchesTheDatabase() {
        isMember(false);

        assertThatThrownBy(() -> messageService.history(USER, ROOM, null, 10))
                .isInstanceOf(ApiException.class);

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("membership is checked before the cursor is validated, so errors cannot probe a room")
    void membershipIsCheckedBeforeCursorValidation() {
        isMember(false);

        assertThatThrownBy(() -> messageService.history(USER, ROOM, "not-an-object-id", null))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode())
                                .as("a non-member must see NOT_A_MEMBER, not INVALID_CURSOR")
                                .isEqualTo("NOT_A_MEMBER"));
    }

    // ---------------------------------------------------------------- send()

    @Test
    @DisplayName("stores the message with the sender from the token and the clock's timestamp")
    void sendStoresMessage() {
        isMember(true);
        when(messageRepository.save(any(Message.class))).thenAnswer(i -> i.getArgument(0));

        Message saved = messageService.send(USER, ROOM, "hello", null);

        assertThat(saved.getContent()).isEqualTo("hello");
        assertThat(saved.getSenderId()).isEqualTo(USER);
        assertThat(saved.getRoomId()).isEqualTo(ROOM);
        assertThat(saved.getContentType()).isEqualTo("text");
        assertThat(saved.getCreatedAt()).isEqualTo(NOW);
        assertThat(saved.getReplyToId()).isNull();
        assertThat(saved.getEditedAt()).isNull();
        assertThat(saved.isDeleted()).isFalse();
    }

    @Test
    @DisplayName("a stored message is announced with exactly the saved document")
    void sendPublishesCreatedEvent() {
        isMember(true);
        when(messageRepository.save(any(Message.class))).thenAnswer(i -> i.getArgument(0));

        Message saved = messageService.send(USER, ROOM, "hello", null);

        ArgumentCaptor<MessageCreatedEvent> event = ArgumentCaptor.forClass(MessageCreatedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().message()).isSameAs(saved);
    }

    @Test
    @DisplayName("a rejected send announces nothing: no socket may see a message that was never stored")
    void rejectedSendPublishesNothing() {
        isMember(false);

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hello", null))
                .isInstanceOf(ApiException.class);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("a failed save announces nothing")
    void failedSavePublishesNothing() {
        isMember(true);
        when(messageRepository.save(any(Message.class))).thenThrow(new RuntimeException("mongo down"));

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hello", null))
                .isInstanceOf(RuntimeException.class);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("a non-member cannot send, and nothing is written")
    void sendRejectsNonMember() {
        isMember(false);

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hello", null))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("NOT_A_MEMBER");
                });

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("a valid reply in the same room is stored")
    void sendAcceptsReplyInSameRoom() {
        isMember(true);
        String replyId = new ObjectId().toHexString();
        when(messageRepository.findById(replyId)).thenReturn(java.util.Optional.of(message("original")));
        when(messageRepository.save(any(Message.class))).thenAnswer(i -> i.getArgument(0));

        Message saved = messageService.send(USER, ROOM, "me too", replyId);

        assertThat(saved.getReplyToId()).isEqualTo(replyId);
    }

    @Test
    @DisplayName("replying across rooms is rejected: it would leak a message from a room you cannot read")
    void sendRejectsReplyFromAnotherRoom() {
        isMember(true);
        String replyId = new ObjectId().toHexString();
        Message otherRoomMessage = Message.create(OTHER_ROOM, USER, null, "secret", "text", NOW);
        when(messageRepository.findById(replyId)).thenReturn(java.util.Optional.of(otherRoomMessage));

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "quoting", replyId))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("REPLY_WRONG_ROOM"));

        verify(messageRepository, never()).save(any());
    }

    @Test
    @DisplayName("replying to a missing message is rejected")
    void sendRejectsMissingReply() {
        isMember(true);
        String replyId = new ObjectId().toHexString();
        when(messageRepository.findById(replyId)).thenReturn(java.util.Optional.empty());

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hi", replyId))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("REPLY_NOT_FOUND"));
    }

    @Test
    @DisplayName("replying to a deleted message is rejected")
    void sendRejectsDeletedReply() {
        isMember(true);
        String replyId = new ObjectId().toHexString();
        Message deleted = message("gone");
        deleted.markDeleted(NOW);
        when(messageRepository.findById(replyId)).thenReturn(java.util.Optional.of(deleted));

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hi", replyId))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("REPLY_DELETED"));
    }

    @Test
    @DisplayName("a malformed reply id is a 400, and no lookup is attempted")
    void sendRejectsMalformedReplyId() {
        isMember(true);

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hi", "not-an-id"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_REPLY_ID");
                });

        verify(messageRepository, never()).findById(any());
    }

    @Test
    @DisplayName("a blank reply id means 'no reply', not an error")
    void sendTreatsBlankReplyIdAsNoReply() {
        isMember(true);
        when(messageRepository.save(any(Message.class))).thenAnswer(i -> i.getArgument(0));

        Message saved = messageService.send(USER, ROOM, "hello", "   ");

        assertThat(saved.getReplyToId()).isNull();
        verify(messageRepository, never()).findById(any());
    }

    @Test
    @DisplayName("membership is checked before the reply is resolved")
    void sendChecksMembershipFirst() {
        isMember(false);

        assertThatThrownBy(() -> messageService.send(USER, ROOM, "hi", "also-invalid"))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode())
                                .as("a non-member must not learn anything about reply ids")
                                .isEqualTo("NOT_A_MEMBER"));
    }

    // ------------------------------------------------------ GET /messages/:id

    private static final String MESSAGE_ID = new ObjectId().toHexString();

    @Test
    @DisplayName("get: a member receives the message")
    void getReturnsMessageToMember() {
        Message stored = message("hello");
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(stored));
        isMember(true);

        assertThat(messageService.get(USER, MESSAGE_ID)).isSameAs(stored);
    }

    @Test
    @DisplayName("get: a soft-deleted message is still returned (the DTO hides its content)")
    void getReturnsDeletedMessage() {
        Message deleted = message("gone");
        deleted.markDeleted(NOW);
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(deleted));
        isMember(true);

        assertThat(messageService.get(USER, MESSAGE_ID).isDeleted()).isTrue();
    }

    @Test
    @DisplayName("get: a malformed id is a 400 and touches neither Mongo nor org")
    void getRejectsMalformedId() {
        assertThatThrownBy(() -> messageService.get(USER, "not-an-object-id"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_MESSAGE_ID");
                });

        verifyNoInteractions(messageRepository, orgClient);
    }

    @Test
    @DisplayName("get: an unknown id is a 404 and org is never asked")
    void getUnknownIdIsNotFound() {
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> messageService.get(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(e.getCode()).isEqualTo("MESSAGE_NOT_FOUND");
                });

        verifyNoInteractions(orgClient);
    }

    @Test
    @DisplayName("get: membership is checked against the room stored on the message")
    void getChecksMembershipOfTheMessagesRoom() {
        Message elsewhere = Message.create(OTHER_ROOM, "someone-else", null, "hi", "text", NOW);
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(elsewhere));
        when(orgClient.isMember(USER, OTHER_ROOM)).thenReturn(true);

        assertThat(messageService.get(USER, MESSAGE_ID)).isSameAs(elsewhere);
        verify(orgClient).isMember(USER, OTHER_ROOM);
    }

    @Test
    @DisplayName("get: a non-member gets exactly the same 404 as an unknown id")
    void getNonMemberLooksLikeUnknownId() {
        String unknownId = new ObjectId().toHexString();
        when(messageRepository.findById(unknownId)).thenReturn(Optional.empty());
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message("secret")));
        isMember(false);

        ApiException unknown = catchApiException(() -> messageService.get(USER, unknownId));
        ApiException hidden = catchApiException(() -> messageService.get(USER, MESSAGE_ID));

        assertThat(hidden.getStatus()).isEqualTo(HttpStatus.NOT_FOUND).isEqualTo(unknown.getStatus());
        assertThat(hidden.getCode()).isEqualTo(unknown.getCode());
        assertThat(hidden.getMessage())
                .as("the message text must not reveal that the message exists")
                .isEqualTo(unknown.getMessage());
    }

    @Test
    @DisplayName("get: org-service down surfaces as 503, never as a 404 or a leak")
    void getPropagatesOrgOutage() {
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message("hello")));
        when(orgClient.isMember(USER, ROOM)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable"));

        assertThatThrownBy(() -> messageService.get(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("ORG_UNAVAILABLE"));
    }

    private static ApiException catchApiException(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        return (ApiException) org.assertj.core.api.Assertions.catchThrowableOfType(call, ApiException.class);
    }

    // ---------------------------------------------------- PATCH /messages/:id

    /** A message by USER in ROOM, sent at the given instant (NOW is the fixed clock). */
    private Message sentAt(Instant createdAt) {
        return Message.create(ROOM, USER, null, "original", "text", createdAt);
    }

    private void stored(Message message) {
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message));
    }

    @Test
    @DisplayName("edit: the sender's edit replaces the content and stamps edited_at from the clock")
    void editUpdatesContentAndEditedAt() {
        Instant createdAt = NOW.minusSeconds(60);
        stored(sentAt(createdAt));
        isMember(true);
        when(messageRepository.applyEditIfLive(MESSAGE_ID, "fixed typo", NOW)).thenReturn(1L);

        Message edited = messageService.edit(USER, MESSAGE_ID, "fixed typo");

        assertThat(edited.getContent()).isEqualTo("fixed typo");
        assertThat(edited.getEditedAt()).isEqualTo(NOW);
        assertThat(edited.getCreatedAt()).as("an edit never moves the message in history").isEqualTo(createdAt);
        assertThat(edited.getSenderId()).isEqualTo(USER);
        assertThat(edited.getRoomId()).isEqualTo(ROOM);
    }

    @Test
    @DisplayName("edit: publishes MessageEditedEvent carrying the edited message")
    void editPublishesEditedEvent() {
        stored(sentAt(NOW.minusSeconds(60)));
        isMember(true);
        when(messageRepository.applyEditIfLive(MESSAGE_ID, "fixed typo", NOW)).thenReturn(1L);

        Message edited = messageService.edit(USER, MESSAGE_ID, "fixed typo");

        ArgumentCaptor<MessageEditedEvent> event = ArgumentCaptor.forClass(MessageEditedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().message()).isSameAs(edited);
        assertThat(event.getValue().message().getContent()).isEqualTo("fixed typo");
    }

    @Test
    @DisplayName("edit: 1 ms before the 15-minute mark is still allowed (boundary)")
    void editAllowedJustInsideWindow() {
        stored(sentAt(NOW.minus(MessageService.EDIT_WINDOW).plusMillis(1)));
        isMember(true);
        when(messageRepository.applyEditIfLive(MESSAGE_ID, "just in time", NOW)).thenReturn(1L);

        assertThat(messageService.edit(USER, MESSAGE_ID, "just in time").getContent())
                .isEqualTo("just in time");
    }

    @Test
    @DisplayName("edit: at exactly 15:00 the edit is refused (spec: now < created_at + 15 min)")
    void editRefusedAtWindowBoundary() {
        stored(sentAt(NOW.minus(MessageService.EDIT_WINDOW)));
        isMember(true);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "too late"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("EDIT_WINDOW_EXPIRED");
                });

        verify(messageRepository, never()).applyEditIfLive(any(), any(), any());
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("edit: long after the window is refused too")
    void editRefusedLongAfterWindow() {
        stored(sentAt(NOW.minusSeconds(24 * 3600)));
        isMember(true);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "way too late"))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("EDIT_WINDOW_EXPIRED"));
    }

    @Test
    @DisplayName("edit: another member cannot edit someone else's message")
    void editRefusedForNonSender() {
        stored(Message.create(ROOM, "someone-else", null, "theirs", "text", NOW.minusSeconds(60)));
        isMember(true);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "hijacked"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("NOT_SENDER");
                });

        verify(messageRepository, never()).applyEditIfLive(any(), any(), any());
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("edit: a deleted message cannot be edited back to life")
    void editRefusedForDeletedMessage() {
        Message deleted = sentAt(NOW.minusSeconds(60));
        deleted.markDeleted(NOW.minusSeconds(30));
        stored(deleted);
        isMember(true);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "resurrected"))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("MESSAGE_DELETED"));

        verify(messageRepository, never()).applyEditIfLive(any(), any(), any());
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("edit: a sender who left the room gets 404, like any outsider")
    void editRefusedForSenderNoLongerMember() {
        stored(sentAt(NOW.minusSeconds(60)));
        isMember(false);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "after leaving"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(e.getCode()).isEqualTo("MESSAGE_NOT_FOUND");
                });

        verify(messageRepository, never()).applyEditIfLive(any(), any(), any());
    }

    @Test
    @DisplayName("edit: a malformed id is a 400 and nothing is loaded or saved")
    void editRejectsMalformedId() {
        assertThatThrownBy(() -> messageService.edit(USER, "not-an-id", "x"))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("INVALID_MESSAGE_ID"));

        verifyNoInteractions(messageRepository, orgClient, events);
    }

    @Test
    @DisplayName("edit: a failed save publishes nothing")
    void editFailedSavePublishesNothing() {
        stored(sentAt(NOW.minusSeconds(60)));
        isMember(true);
        when(messageRepository.applyEditIfLive(MESSAGE_ID, "lost", NOW)).thenThrow(new IllegalStateException("mongo down"));

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "lost"))
                .isInstanceOf(IllegalStateException.class);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("edit: a delete that lands between load and write wins; nothing is announced")
    void editLosesRaceAgainstDelete() {
        stored(sentAt(NOW.minusSeconds(60)));
        isMember(true);
        when(messageRepository.applyEditIfLive(MESSAGE_ID, "too slow", NOW)).thenReturn(0L);

        assertThatThrownBy(() -> messageService.edit(USER, MESSAGE_ID, "too slow"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("MESSAGE_DELETED");
                });

        verifyNoInteractions(events);
    }

    // --------------------------------------------------- DELETE /messages/:id

    private void role(String role) {
        when(orgClient.membership(USER, ROOM)).thenReturn(new Membership(true, role));
    }

    @Test
    @DisplayName("delete: the sender soft-deletes their own message and it is announced once")
    void deleteOwnMessage() {
        stored(sentAt(NOW.minusSeconds(60)));
        role("MEMBER");
        when(messageRepository.markDeletedIfLive(MESSAGE_ID, NOW)).thenReturn(1L);

        messageService.delete(USER, MESSAGE_ID);

        ArgumentCaptor<MessageDeletedEvent> event = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().message().isDeleted()).isTrue();
        assertThat(event.getValue().message().getDeletedAt()).isEqualTo(NOW);
        verify(messageRepository, never()).save(any());
        verify(messageRepository, never()).deleteById(any());
    }

    @Test
    @DisplayName("delete: an ADMIN or OWNER may delete someone else's message")
    void moderatorDeletesOthersMessage() {
        for (String moderator : List.of("ADMIN", "OWNER")) {
            org.mockito.Mockito.reset(messageRepository, orgClient, events);
            stored(Message.create(ROOM, "someone-else", null, "spam", "text", NOW.minusSeconds(60)));
            role(moderator);
            when(messageRepository.markDeletedIfLive(MESSAGE_ID, NOW)).thenReturn(1L);

            messageService.delete(USER, MESSAGE_ID);

            verify(events).publishEvent(any(MessageDeletedEvent.class));
        }
    }

    @Test
    @DisplayName("delete: a plain member cannot delete someone else's message (403)")
    void memberCannotDeleteOthersMessage() {
        stored(Message.create(ROOM, "someone-else", null, "theirs", "text", NOW.minusSeconds(60)));
        role("MEMBER");

        assertThatThrownBy(() -> messageService.delete(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getCode()).isEqualTo("NOT_ALLOWED");
                });

        verify(messageRepository, never()).markDeletedIfLive(any(), any());
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("delete: an org-service that sends no role means no moderation rights")
    void missingRoleCannotModerate() {
        stored(Message.create(ROOM, "someone-else", null, "theirs", "text", NOW.minusSeconds(60)));
        role("");

        assertThatThrownBy(() -> messageService.delete(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("NOT_ALLOWED"));
    }

    @Test
    @DisplayName("delete: a non-member gets the same 404 as an unknown id")
    void nonMemberGets404() {
        stored(sentAt(NOW.minusSeconds(60)));
        when(orgClient.membership(USER, ROOM)).thenReturn(Membership.NONE);

        assertThatThrownBy(() -> messageService.delete(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(e.getCode()).isEqualTo("MESSAGE_NOT_FOUND");
                });

        verify(messageRepository, never()).markDeletedIfLive(any(), any());
    }

    @Test
    @DisplayName("delete: deleting an already-deleted message is not an error, and is not announced again")
    void deleteTwiceIsSilent() {
        Message deleted = sentAt(NOW.minusSeconds(60));
        deleted.markDeleted(NOW.minusSeconds(30));
        stored(deleted);
        role("MEMBER");
        when(messageRepository.markDeletedIfLive(MESSAGE_ID, NOW)).thenReturn(0L);

        messageService.delete(USER, MESSAGE_ID);

        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("delete: an unknown id is 404, a malformed one is 400 and touches nothing")
    void deleteUnknownAndMalformedIds() {
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> messageService.delete(USER, MESSAGE_ID))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("MESSAGE_NOT_FOUND"));
        assertThatThrownBy(() -> messageService.delete(USER, "not-an-id"))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo("INVALID_MESSAGE_ID"));

        verifyNoInteractions(orgClient, events);
    }
}
