package com.fttranscendence.chatservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;

class RoomChangedConsumerTest {
    static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    final ChatWebSocketHandler sockets = mock(ChatWebSocketHandler.class);
    final RoomMembersCache cache = mock(RoomMembersCache.class);
    final MessageRepository messages = mock(MessageRepository.class);
    final RoomChangedConsumer consumer = new RoomChangedConsumer(sockets, cache, messages);

    @Test
    void syntheticUpdatedJsonReachesConsumerAndContractIgnoresHttpSnakeCase() throws Exception {
        String json = """
                {"roomId":"42","change":"ROOM_UPDATED","userIds":["%s"],"roomDeleted":false}
                """.formatted(ALICE);
        var converter = new RabbitMQConfig().roomEventMessageConverter();
        var properties = new MessageProperties();
        properties.setContentType("application/json");
        properties.setInferredArgumentType(RoomChangedMessage.class);
        // An inferred listener argument must win over a foreign Java type header.
        properties.setHeader("__TypeId__", "org.example.NotASharedClass");
        var record = (RoomChangedMessage) converter.fromMessage(
                new Message(json.getBytes(StandardCharsets.UTF_8), properties));
        consumer.consume(record);
        verify(cache).invalidate(42L);
        verify(sockets).sendToUser(ALICE, "room.updated", Map.of("room_id", 42L));
        verifyNoInteractions(messages);
        var tree = new ObjectMapper().readTree(converter.toMessage(record, new MessageProperties()).getBody());
        assertThat(tree.properties()).extracting(Map.Entry::getKey)
                .containsExactlyInAnyOrder("roomId", "change", "userIds", "roomDeleted");
        var httpMapper = new ObjectMapper().setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        assertThat(httpMapper.readValue(json, RoomChangedMessage.class)).isEqualTo(record);
        assertThat(httpMapper.readTree(httpMapper.writeValueAsBytes(record))).isEqualTo(tree);
    }

    @Test
    void allChangesUseFrontendNamesAndOnlyExplicitRecipients() {
        for (String change : List.of("ADDED", "UPDATED", "REMOVED")) {
            consumer.consume(new RoomChangedMessage("42", "ROOM_" + change, List.of(ALICE, BOB), false));
            verify(sockets).sendToUser(ALICE, "room." + change.toLowerCase(), Map.of("room_id", 42L));
            verify(sockets).sendToUser(BOB, "room." + change.toLowerCase(), Map.of("room_id", 42L));
        }
        verify(cache, times(3)).invalidate(42L);
        verifyNoMoreInteractions(sockets, cache);
        verifyNoInteractions(messages);
    }

    @Test
    void deletionCanHaveNoRecipientsAndUsesNumericRoomId() {
        consumer.consume(new RoomChangedMessage("42", "ROOM_REMOVED", List.of(), true));
        verify(messages).deleteByRoomId(42L);
        verifyNoMoreInteractions(messages);
        verify(cache).invalidate(42L);
        verifyNoInteractions(sockets);
    }

    @Test
    void invalidMessagesHaveNoSideEffectsEvenWithDeletionFlag() {
        for (String id : List.of("0", "-1", "abc", " 42", "+42", "1.2", "9223372036854775808")) {
            assertThatThrownBy(() -> consumer.consume(new RoomChangedMessage(id, "ROOM_REMOVED", List.of(ALICE), true)))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        for (var invalid : List.of(
                new RoomChangedMessage("42", "ROOM_CREATED", List.of(ALICE), false),
                new RoomChangedMessage("42", "ROOM_UPDATED", List.of(ALICE), true),
                new RoomChangedMessage("42", "ROOM_REMOVED", List.of(ALICE, "bad"), true),
                new RoomChangedMessage("42", "ROOM_UPDATED", List.of(), false),
                new RoomChangedMessage("42", "ROOM_UPDATED", null, false))) {
            assertThatThrownBy(() -> consumer.consume(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(sockets, cache, messages);
    }

    @Test
    void handlingFailureEscapesToContainerRetryPolicy() {
        doThrow(new IllegalStateException("mongo unavailable")).when(messages).deleteByRoomId(42L);
        assertThatThrownBy(() -> consumer.consume(new RoomChangedMessage("42", "ROOM_REMOVED", List.of(ALICE), true)))
                .isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(sockets, cache);
    }
}
