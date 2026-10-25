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
import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.repository.ReadStateStore;
import com.fttranscendence.chatservice.service.AttachmentCleaner;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;

class RoomChangedConsumerTest {
    static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    final ChatWebSocketHandler sockets = mock(ChatWebSocketHandler.class);
    final RoomMembersCache cache = mock(RoomMembersCache.class);
    final MessageRepository messages = mock(MessageRepository.class);
    final AttachmentCleaner cleaner = mock(AttachmentCleaner.class);
    final ReadStateStore readStates = mock(ReadStateStore.class);
    final RoomChangedConsumer consumer = new RoomChangedConsumer(sockets, cache, messages, cleaner, readStates);

    private RoomChangedMessage convert(String json) {
        var properties = new MessageProperties();
        properties.setContentType("application/json");
        properties.setInferredArgumentType(RoomChangedMessage.class);
        // Deliberately no Java type headers: only the local listener record determines the type.
        return (RoomChangedMessage) new RabbitMQConfig().roomEventMessageConverter().fromMessage(
                new Message(json.getBytes(StandardCharsets.UTF_8), properties));
    }

    @Test
    void allLocalEnumValuesSerializeAndDeserializeWithoutTypeHeaders() throws Exception {
        var expected = Map.of(
                RoomChange.ROOM_ADDED, "ROOM_ADDED",
                RoomChange.ROOM_UPDATED, "ROOM_UPDATED",
                RoomChange.ROOM_REMOVED, "ROOM_REMOVED");
        var converter = new RabbitMQConfig().roomEventMessageConverter();
        for (var entry : expected.entrySet()) {
            var payload = new RoomChangedMessage("42", entry.getKey(), List.of(ALICE), false);
            var message = converter.toMessage(payload, new MessageProperties());
            var json = new ObjectMapper().readTree(message.getBody());
            assertThat(json.path("change").asText()).isEqualTo(entry.getValue());
            assertThat(convert(json.toString())).isEqualTo(payload);
        }
    }

    @Test
    void unknownMissingAndNullChangesHaveNoSideEffects() {
        for (String field : List.of("\"change\":\"ROOM_CREATED\",", "\"change\":\"0\",", "\"change\":0,",
                "\"change\":\"\",", "", "\"change\":null,")) {
            String json = "{\"roomId\":\"42\"," + field
                    + "\"userIds\":[\"" + ALICE + "\"],\"roomDeleted\":true}";
            if (!field.isEmpty() && !field.contains("null")) {
                assertThatThrownBy(() -> convert(json))
                        .isInstanceOf(org.springframework.amqp.support.converter.MessageConversionException.class);
            } else {
                var payload = convert(json);
                assertThat(payload.change()).isNull();
                assertThatThrownBy(() -> consumer.consume(payload)).isInstanceOf(IllegalArgumentException.class);
            }
        }
        verifyNoInteractions(sockets, cache, messages, cleaner);
    }

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
        var expected = Map.of(RoomChange.ROOM_ADDED, "room.added",
                RoomChange.ROOM_UPDATED, "room.updated", RoomChange.ROOM_REMOVED, "room.removed");
        expected.forEach((change, event) -> {
            consumer.consume(new RoomChangedMessage("42", change, List.of(ALICE, BOB), false));
            verify(sockets).sendToUser(ALICE, event, Map.of("room_id", 42L));
            verify(sockets).sendToUser(BOB, event, Map.of("room_id", 42L));
        });
        verify(cache, times(3)).invalidate(42L);
        // A removal also ends the live feed of the room for the removed users.
        verify(sockets).revokeRoom(ALICE, 42L);
        verify(sockets).revokeRoom(BOB, 42L);
        verifyNoMoreInteractions(sockets, cache);
        verifyNoInteractions(messages);
    }

    @Test
    void addedAndUpdatedKeepSubscriptions() {
        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_ADDED, List.of(ALICE), false));
        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_UPDATED, List.of(BOB), false));
        verify(sockets, never()).revokeRoom(anyString(), anyLong());
        verify(sockets, never()).closeRoom(anyLong());
    }

    @Test
    void removalRevokesBeforeTellingTheUser() {
        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(ALICE), false));
        // Unsubscribe first: once room.removed arrives, no message.new may follow.
        var order = inOrder(sockets);
        order.verify(sockets).revokeRoom(ALICE, 42L);
        order.verify(sockets).sendToUser(ALICE, "room.removed", Map.of("room_id", 42L));
        verify(sockets, never()).closeRoom(anyLong());
    }

    @Test
    void deletionCanHaveNoRecipientsAndUsesNumericRoomId() {
        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(), true));
        verify(messages).findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(42L);
        verify(messages).deleteByRoomId(42L);
        verify(readStates).deleteByRoomId(42L);
        verifyNoMoreInteractions(messages);
        verify(cleaner).deleteAll(List.of());
        verify(cache).invalidate(42L);
        // The room is gone: every subscription to it ends, whoever holds it.
        verify(sockets).closeRoom(42L);
        verifyNoMoreInteractions(sockets);
    }

    @Test
    void invalidMessagesHaveNoSideEffectsEvenWithDeletionFlag() {
        for (String id : List.of("0", "-1", "abc", " 42", "+42", "1.2", "9223372036854775808")) {
            assertThatThrownBy(() -> consumer.consume(new RoomChangedMessage(id, RoomChange.ROOM_REMOVED, List.of(ALICE), true)))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        for (var invalid : List.of(
                new RoomChangedMessage("42", null, List.of(ALICE), false),
                new RoomChangedMessage("42", RoomChange.ROOM_ADDED, List.of(ALICE), true),
                new RoomChangedMessage("42", RoomChange.ROOM_UPDATED, List.of(ALICE), true),
                new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(ALICE, "bad"), true),
                new RoomChangedMessage("42", RoomChange.ROOM_UPDATED, List.of(), false),
                new RoomChangedMessage("42", RoomChange.ROOM_UPDATED, null, false))) {
            assertThatThrownBy(() -> consumer.consume(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(sockets, cache, messages, cleaner);
    }

    @Test
    void handlingFailureEscapesToContainerRetryPolicy() {
        doThrow(new IllegalStateException("mongo unavailable")).when(messages).deleteByRoomId(42L);
        assertThatThrownBy(() -> consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(ALICE), true)))
                .isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(sockets, cache);
        // Messages still exist, so their images must stay: the redelivery cleans both.
        verifyNoInteractions(cleaner);
    }

    @Test
    void deletionCleansTheImagesOfLiveMessagesAfterDeletingThem() {
        var first = new Attachment("m1", ALICE, "image/webp", 10, 10);
        var second = new Attachment("m2", ALICE, "image/webp", 10, 10);
        var third = new Attachment("m3", BOB, "image/webp", 10, 10);
        var now = java.time.Instant.parse("2026-10-23T10:00:00Z");
        when(messages.findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(42L)).thenReturn(List.of(
                com.fttranscendence.chatservice.model.Message.create(42L, ALICE, null, null, "text", now, List.of(first, second)),
                com.fttranscendence.chatservice.model.Message.create(42L, BOB, null, "hi", "text", now, List.of(third))));

        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(), true));

        // Read the ids first, delete the messages, then the images.
        var order = inOrder(messages, cleaner);
        order.verify(messages).findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(42L);
        order.verify(messages).deleteByRoomId(42L);
        order.verify(cleaner).deleteAll(List.of(first, second, third));
    }

    @Test
    void ordinaryRemovalTouchesNoImages() {
        consumer.consume(new RoomChangedMessage("42", RoomChange.ROOM_REMOVED, List.of(ALICE), false));
        verifyNoInteractions(messages, cleaner);
    }
}
