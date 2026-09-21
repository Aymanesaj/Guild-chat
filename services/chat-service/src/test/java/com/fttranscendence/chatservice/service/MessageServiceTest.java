package com.fttranscendence.chatservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;

import org.bson.types.ObjectId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;

import com.fttranscendence.chatservice.exception.ApiException;
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

    @Mock
    private MessageRepository messageRepository;

    @InjectMocks
    private MessageService messageService;

    private Message message(String content) {
        return Message.create(ROOM, "a215c5f8-d810-4518-ad4c-8d551eb6dfc4",
                null, content, "text", Instant.now());
    }

    @Test
    @DisplayName("no cursor: reads the newest page with the default limit of 50")
    void newestPageUsesDefaultLimit() {
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any()))
                .thenReturn(List.of(message("hello")));

        List<Message> result = messageService.history(ROOM, null, null);

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
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any())).thenReturn(List.of());

        messageService.history(ROOM, "   ", null);

        verify(messageRepository).findByRoomIdOrderByIdDesc(eq(ROOM), any());
    }

    @Test
    @DisplayName("with a cursor: reads the page before it, honouring the requested limit")
    void olderPageUsesCursorAndLimit() {
        when(messageRepository.findByRoomIdAndIdLessThanOrderByIdDesc(eq(ROOM), eq(CURSOR), any()))
                .thenReturn(List.of(message("older")));

        messageService.history(ROOM, CURSOR, 10);

        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(messageRepository)
                .findByRoomIdAndIdLessThanOrderByIdDesc(eq(ROOM), eq(CURSOR), limit.capture());
        assertThat(limit.getValue().max()).isEqualTo(10);
    }

    @Test
    @DisplayName("a cursor that is not an ObjectId is a 400, not a 500 from the driver")
    void rejectsMalformedCursor() {
        assertThatThrownBy(() -> messageService.history(ROOM, "not-an-object-id", null))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_CURSOR");
                });

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("limit above the maximum is rejected: ?limit=1000000 must not be a free DoS")
    void rejectsTooLargeLimit() {
        assertThatThrownBy(() -> messageService.history(ROOM, null, MessageService.MAX_LIMIT + 1))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getCode()).isEqualTo("INVALID_LIMIT");
                });

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("limit of zero or negative is rejected")
    void rejectsNonPositiveLimit() {
        assertThatThrownBy(() -> messageService.history(ROOM, null, 0))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> messageService.history(ROOM, null, -5))
                .isInstanceOf(ApiException.class);

        verifyNoInteractions(messageRepository);
    }

    @Test
    @DisplayName("the maximum limit itself is allowed (boundary)")
    void acceptsTheMaximumLimit() {
        when(messageRepository.findByRoomIdOrderByIdDesc(eq(ROOM), any())).thenReturn(List.of());

        messageService.history(ROOM, null, MessageService.MAX_LIMIT);

        ArgumentCaptor<Limit> limit = ArgumentCaptor.forClass(Limit.class);
        verify(messageRepository).findByRoomIdOrderByIdDesc(eq(ROOM), limit.capture());
        assertThat(limit.getValue().max()).isEqualTo(MessageService.MAX_LIMIT);
    }
}
