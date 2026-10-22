package com.fttranscendence.chatservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.support.converter.MessageConversionException;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.service.MessageService;

class RoomTimelineConsumerTest {
    static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    static final String EVENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    static final String AT = "2026-10-22T10:00:00.123Z";

    final MessageService messages = mock(MessageService.class);
    final RoomTimelineConsumer consumer = new RoomTimelineConsumer(messages);

    static RoomTimelineMessage event(RoomTimelineType type, String actor, String target,
            String role, String previousRole, String name, String previousName) {
        return new RoomTimelineMessage(EVENT, 1, type, "42", actor, target, role, previousRole, name, previousName, AT);
    }

    /** Exactly what org's RoomTimelinePublisher puts on the wire: every field present, unused ones null. */
    static RoomTimelineMessage fromOrgJson(String json) {
        var properties = new MessageProperties();
        properties.setContentType("application/json");
        properties.setInferredArgumentType(RoomTimelineMessage.class);
        return (RoomTimelineMessage) new RabbitMQConfig().roomEventMessageConverter()
                .fromMessage(new Message(json.getBytes(StandardCharsets.UTF_8), properties));
    }

    private SystemEvent storedFor(RoomTimelineMessage event) {
        when(messages.recordSystemEvent(any(), any(), any(), any())).thenReturn(true);
        consumer.consume(event);
        var system = org.mockito.ArgumentCaptor.forClass(SystemEvent.class);
        verify(messages).recordSystemEvent(eq(42L), eq(EVENT), system.capture(), eq(Instant.parse(AT)));
        return system.getValue();
    }

    @Test
    void orgJsonConvertsAndIsStored() {
        RoomTimelineMessage converted = fromOrgJson("""
                {"eventId":"%s","version":1,"type":"MEMBER_KICKED","roomId":"42","actorId":"%s",
                 "targetId":"%s","role":null,"previousRole":null,"name":null,"previousName":null,
                 "occurredAt":"%s"}
                """.formatted(EVENT, ALICE, BOB, AT));

        assertThat(storedFor(converted))
                .isEqualTo(new SystemEvent("MEMBER_KICKED", ALICE, BOB, null, null, null, null));
    }

    @Test
    void unknownTypeIsRejectedAtConversion() {
        // A type Chat does not know yet must never be stored as a known one.
        assertThatThrownBy(() -> fromOrgJson("""
                {"eventId":"%s","version":1,"type":"ROOM_ARCHIVED","roomId":"42","actorId":"%s",
                 "targetId":null,"role":null,"previousRole":null,"name":null,"previousName":null,
                 "occurredAt":"%s"}
                """.formatted(EVENT, ALICE, AT)))
                .isInstanceOf(MessageConversionException.class);
    }

    @Test
    void everyTypeKeepsItsFields() {
        assertThat(storedFor(event(RoomTimelineType.ROOM_CREATED, ALICE, null, null, null, "Ops", null)))
                .isEqualTo(new SystemEvent("ROOM_CREATED", ALICE, null, null, null, "Ops", null));
        reset(messages);
        assertThat(storedFor(event(RoomTimelineType.ROOM_RENAMED, ALICE, null, null, null, "Ops 2", "Ops")))
                .isEqualTo(new SystemEvent("ROOM_RENAMED", ALICE, null, null, null, "Ops 2", "Ops"));
        reset(messages);
        assertThat(storedFor(event(RoomTimelineType.MEMBER_JOINED, ALICE, BOB, null, null, null, null)))
                .isEqualTo(new SystemEvent("MEMBER_JOINED", ALICE, BOB, null, null, null, null));
        reset(messages);
        assertThat(storedFor(event(RoomTimelineType.MEMBER_LEFT, BOB, BOB, null, null, null, null)))
                .isEqualTo(new SystemEvent("MEMBER_LEFT", BOB, BOB, null, null, null, null));
        reset(messages);
        assertThat(storedFor(event(RoomTimelineType.OWNERSHIP_TRANSFERRED, ALICE, BOB, "OWNER", "ADMIN", null, null)))
                .isEqualTo(new SystemEvent("OWNERSHIP_TRANSFERRED", ALICE, BOB, "OWNER", "ADMIN", null, null));
        reset(messages);
        assertThat(storedFor(event(RoomTimelineType.ROLE_CHANGED, ALICE, BOB, "ADMIN", "MEMBER", null, null)))
                .isEqualTo(new SystemEvent("ROLE_CHANGED", ALICE, BOB, "ADMIN", "MEMBER", null, null));
    }

    @Test
    void renameWithoutPreviousNameIsAllowed() {
        // A room can have had no name before (contract: previousName may be null).
        assertThat(storedFor(event(RoomTimelineType.ROOM_RENAMED, ALICE, null, null, null, "Ops", null)).previousName())
                .isNull();
    }

    @Test
    void fieldsThatDoNotBelongToTheTypeAreDropped() {
        SystemEvent joined = storedFor(event(RoomTimelineType.MEMBER_JOINED, ALICE, BOB, "ADMIN", "MEMBER", "x", "y"));

        assertThat(joined).isEqualTo(new SystemEvent("MEMBER_JOINED", ALICE, BOB, null, null, null, null));
    }

    @Test
    void redeliveredEventIsAcceptedWithoutError() {
        // recordSystemEvent reports the duplicate; the delivery must still be acknowledged.
        when(messages.recordSystemEvent(any(), any(), any(), any())).thenReturn(false);

        assertThatCode(() -> consumer.consume(event(RoomTimelineType.MEMBER_JOINED, ALICE, BOB, null, null, null, null)))
                .doesNotThrowAnyException();
    }

    @Test
    void invalidEventsStoreNothing() {
        var invalid = List.of(
                new RoomTimelineMessage(EVENT, 2, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, null, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, 1, null, "42", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage("not-a-uuid", 1, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, 1, RoomTimelineType.MEMBER_JOINED, "0", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, 1, RoomTimelineType.MEMBER_JOINED, "abc", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, 1, RoomTimelineType.MEMBER_JOINED, "9223372036854775808", ALICE, BOB, null, null, null, null, AT),
                new RoomTimelineMessage(EVENT, 1, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB, null, null, null, null, "yesterday"),
                new RoomTimelineMessage(EVENT, 1, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB, null, null, null, null, null),
                event(RoomTimelineType.MEMBER_JOINED, null, BOB, null, null, null, null),
                event(RoomTimelineType.MEMBER_JOINED, ALICE, null, null, null, null, null),
                event(RoomTimelineType.MEMBER_LEFT, ALICE, BOB, null, null, null, null),
                event(RoomTimelineType.MEMBER_KICKED, ALICE, ALICE, null, null, null, null),
                event(RoomTimelineType.OWNERSHIP_TRANSFERRED, ALICE, BOB, "ADMIN", "MEMBER", null, null),
                event(RoomTimelineType.OWNERSHIP_TRANSFERRED, ALICE, BOB, "OWNER", null, null, null),
                event(RoomTimelineType.ROLE_CHANGED, ALICE, BOB, null, "MEMBER", null, null),
                event(RoomTimelineType.ROLE_CHANGED, ALICE, BOB, "SUPERUSER", "MEMBER", null, null),
                event(RoomTimelineType.ROOM_CREATED, ALICE, null, null, null, "  ", null),
                event(RoomTimelineType.ROOM_RENAMED, ALICE, null, null, null, null, "Ops"));

        for (RoomTimelineMessage bad : invalid) {
            // IllegalArgumentException, never a NullPointerException: a missing role must not crash validation.
            assertThatThrownBy(() -> consumer.consume(bad))
                    .as("%s", bad)
                    .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(messages);
    }

    @Test
    void storageFailureEscapesToTheRetryPolicy() {
        when(messages.recordSystemEvent(any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("mongo unavailable"));

        assertThatThrownBy(() -> consumer.consume(event(RoomTimelineType.MEMBER_JOINED, ALICE, BOB, null, null, null, null)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void eventIdsAreStoredAsSent() {
        String other = UUID.randomUUID().toString();
        when(messages.recordSystemEvent(any(), any(), any(), any())).thenReturn(true);

        consumer.consume(new RoomTimelineMessage(other, 1, RoomTimelineType.MEMBER_JOINED, "42", ALICE, BOB,
                null, null, null, null, AT));

        verify(messages).recordSystemEvent(eq(42L), eq(other), any(), any());
    }
}
