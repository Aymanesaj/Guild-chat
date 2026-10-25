package com.fttranscendence.chatservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.support.converter.MessageConversionException;

import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.service.NotificationService;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;

class FriendshipEventConsumerTest {
    static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    static final String FRIENDSHIP = "0f8fad5b-d9cb-469f-a165-70867728950e";
    static final String EVENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

    final ChatWebSocketHandler sockets = mock(ChatWebSocketHandler.class);
    final NotificationService notifications = mock(NotificationService.class);
    final FriendshipEventConsumer consumer = new FriendshipEventConsumer(sockets, notifications);

    static FriendshipEvent event(FriendshipEventType type) {
        return new FriendshipEvent(EVENT, type, 1, FRIENDSHIP, ALICE, BOB, "2026-10-21T10:00:00.000Z");
    }

    /** Exactly what identity's friendship.publisher.ts puts on the wire (no __TypeId__ header). */
    static FriendshipEvent fromIdentityJson(String json) {
        var properties = new MessageProperties();
        properties.setContentType("application/json");
        properties.setInferredArgumentType(FriendshipEvent.class);
        return (FriendshipEvent) new RabbitMQConfig().roomEventMessageConverter()
                .fromMessage(new Message(json.getBytes(StandardCharsets.UTF_8), properties));
    }

    @Test
    void identityJsonConvertsToTheRecord() {
        FriendshipEvent record = fromIdentityJson("""
                {"eventId":"%s","eventType":"FRIEND_REQUEST_SENT","version":1,"friendshipId":"%s",
                 "requesterId":"%s","addresseeId":"%s","occurredAt":"2026-10-21T10:00:00.000Z"}
                """.formatted(EVENT, FRIENDSHIP, ALICE, BOB));

        assertThat(record).isEqualTo(new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 1,
                FRIENDSHIP, ALICE, BOB, "2026-10-21T10:00:00.000Z"));
    }

    @Test
    void unknownEventTypeIsRejectedAtConversion() {
        // A future identity event chat does not know yet must not be read as a known one.
        assertThatThrownBy(() -> fromIdentityJson("""
                {"eventId":"%s","eventType":"FRIENDSHIP_REMOVED","version":1,"friendshipId":"%s",
                 "requesterId":"%s","addresseeId":"%s","occurredAt":"2026-10-21T10:00:00.000Z"}
                """.formatted(EVENT, FRIENDSHIP, ALICE, BOB)))
                .isInstanceOf(MessageConversionException.class);
    }

    @Test
    void sentNotifiesAddresseeAndRequesterTabs() {
        consumer.consume(event(FriendshipEventType.FRIEND_REQUEST_SENT));

        verify(sockets).sendToUser(BOB, "friend.request.received", Map.of("friendship_id", FRIENDSHIP, "user_id", ALICE));
        verify(sockets).sendToUser(ALICE, "friend.request.sent", Map.of("friendship_id", FRIENDSHIP, "user_id", BOB));
        verifyNoMoreInteractions(sockets);
        verify(notifications).friendRequestSent(EVENT, FRIENDSHIP, ALICE, BOB);
        verifyNoMoreInteractions(notifications);
    }

    @Test
    void acceptedNotifiesBothWithTheOtherUser() {
        consumer.consume(event(FriendshipEventType.FRIEND_REQUEST_ACCEPTED));

        verify(sockets).sendToUser(ALICE, "friend.added", Map.of("friendship_id", FRIENDSHIP, "user_id", BOB));
        verify(sockets).sendToUser(BOB, "friend.added", Map.of("friendship_id", FRIENDSHIP, "user_id", ALICE));
        verifyNoMoreInteractions(sockets);
        verify(notifications).friendRequestAccepted(EVENT, FRIENDSHIP, ALICE, BOB);
        verifyNoMoreInteractions(notifications);
    }

    @Test
    void invalidEventsSendNothing() {
        for (var invalid : List.of(
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 2, FRIENDSHIP, ALICE, BOB, null),
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, null, FRIENDSHIP, ALICE, BOB, null),
                new FriendshipEvent(EVENT, null, 1, FRIENDSHIP, ALICE, BOB, null),
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 1, FRIENDSHIP, "bad", BOB, null),
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 1, FRIENDSHIP, ALICE, null, null),
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 1, "42", ALICE, BOB, null),
                new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_SENT, 1, FRIENDSHIP, ALICE, ALICE, null),
                new FriendshipEvent(null, FriendshipEventType.FRIEND_REQUEST_SENT, 1, FRIENDSHIP, ALICE, BOB, null))) {
            assertThatThrownBy(() -> consumer.consume(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(sockets, notifications);
    }

    @Test
    void sendingFailuresDoNotHappenBeforeValidation() {
        // A half-valid event must not reach the first user and then fail on the second.
        var halfValid = new FriendshipEvent(EVENT, FriendshipEventType.FRIEND_REQUEST_ACCEPTED, 1, FRIENDSHIP, ALICE,
                "not-a-uuid", null);
        assertThatThrownBy(() -> consumer.consume(halfValid)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(sockets);
    }
}
