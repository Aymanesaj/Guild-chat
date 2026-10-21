package com.ft_transcendence.orgservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.service.RoomTimelineEvent;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.*;
import tools.jackson.databind.json.JsonMapper;

class RoomTimelinePublisherTest {
    final RabbitTemplate rabbit = mock(RabbitTemplate.class);
    final RabbitAdmin admin = mock(RabbitAdmin.class);
    final RoomTimelinePublisher publisher = new RoomTimelinePublisher(rabbit, admin, 20);
    final RoomTimelineEvent event = new RoomTimelineEvent(UUID.randomUUID(), 1,
            RoomTimelineType.MEMBER_KICKED, 42L, UUID.randomUUID(), UUID.randomUUID(),
            null, null, null, null, Instant.parse("2026-10-21T12:34:56.123Z"));

    @Test
    void exactJsonContractSurvivesGlobalNullExclusionAndNamingStrategy() {
        var mapper = JsonMapper.builder()
                .changeDefaultPropertyInclusion(v -> JsonInclude.Value.construct(
                        JsonInclude.Include.NON_NULL, JsonInclude.Include.NON_NULL))
                .propertyNamingStrategy(tools.jackson.databind.PropertyNamingStrategies.SNAKE_CASE).build();
        for (var type : RoomTimelineType.values()) {
            var snapshot = new RoomTimelineEvent(event.eventId(), 1, type, 42L, event.actorId(),
                    event.targetId(), RoleName.OWNER, RoleName.ADMIN, "new", "old", event.occurredAt());
            var wire = RoomTimelineMessage.from(snapshot);
            var json = mapper.readTree(mapper.writeValueAsBytes(wire));
            assertThat(json.propertyNames()).containsExactlyInAnyOrder("eventId", "version", "type",
                    "roomId", "actorId", "targetId", "role", "previousRole", "name", "previousName", "occurredAt");
            assertThat(wire.eventId()).isEqualTo(snapshot.eventId().toString());
            assertThat(wire.actorId()).isEqualTo(snapshot.actorId().toString());
            assertThat(wire.targetId()).isEqualTo(snapshot.targetId().toString());
            assertThat(wire.role()).isEqualTo(snapshot.role());
            assertThat(wire.previousRole()).isEqualTo(snapshot.previousRole());
            assertThat(wire.name()).isEqualTo(snapshot.name());
            assertThat(wire.previousName()).isEqualTo(snapshot.previousName());
            assertThat(wire.occurredAt()).isEqualTo(snapshot.occurredAt().toString());
            assertThat(json.path("roomId").isString()).isTrue();
            assertThat(json.path("roomId").asString()).isEqualTo("42");
            assertThat(json.path("version").isIntegralNumber()).isTrue();
            assertThat(json.path("version").asInt()).isEqualTo(1);
            assertThat(json.path("type").asString()).isEqualTo(type.name());
            assertThat(json.path("role").asString()).isEqualTo("OWNER");
            assertThat(json.path("previousRole").asString()).isEqualTo("ADMIN");
            assertThat(Instant.parse(json.path("occurredAt").asString())).isEqualTo(snapshot.occurredAt());
            assertThat(json.path("occurredAt").asString()).endsWith("Z");
        }
        var nullEvent = new RoomTimelineEvent(event.eventId(), 1, RoomTimelineType.ROOM_CREATED,
                42L, event.actorId(), null, null, null, null, null, event.occurredAt());
        var json = mapper.readTree(mapper.writeValueAsBytes(RoomTimelineMessage.from(nullEvent)));
        assertThat(json.size()).isEqualTo(11);
        for (String field : List.of("targetId", "role", "previousRole", "name", "previousName")) {
            assertThat(json.has(field)).isTrue();
            assertThat(json.path(field).isNull()).isTrue();
        }
    }

    @Test
    void declaresBeforeSendingPersistentJsonWithStableIdentityAndPositiveConfirm() {
        doAnswer(call -> {
            var payload = call.getArgument(2, RoomTimelineMessage.class);
            assertThat(payload).isEqualTo(RoomTimelineMessage.from(event));
            var message = new RabbitMQConfig().roomEventMessageConverter().toMessage(payload, new MessageProperties());
            var processed = call.getArgument(3, MessagePostProcessor.class).postProcessMessage(message);
            var properties = processed.getMessageProperties();
            assertThat(properties.getContentType()).isEqualTo("application/json");
            assertThat(properties.getDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
            assertThat(properties.getHeaders()).doesNotContainKey("__TypeId__");
            assertThat(properties.getMessageId()).isEqualTo(event.eventId().toString());
            var correlation = call.getArgument(4, CorrelationData.class);
            assertThat(correlation.getId()).isEqualTo(event.eventId().toString());
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).convertAndSend(eq(RabbitMQConfig.ROOM_EVENTS_EXCHANGE), eq("room.timeline"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
        publisher.onRoomTimeline(event);
        publisher.onRoomTimeline(event); // Retransmitting the same snapshot preserves its identity.
        var order = inOrder(admin, rabbit);
        for (int i = 0; i < 2; i++) {
            order.verify(admin).initialize();
            order.verify(rabbit).convertAndSend(eq(RabbitMQConfig.ROOM_EVENTS_EXCHANGE), eq("room.timeline"),
                    any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
        }
    }

    @Test
    void logsAllTransportFailuresWithoutFailingCommittedAction() throws Exception {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(RoomTimelinePublisher.class);
        // Async callbacks can append from another thread.
        var logs = new java.util.concurrent.CopyOnWriteArrayList<ch.qos.logback.classic.spi.ILoggingEvent>();
        var appender = new ch.qos.logback.core.AppenderBase<ch.qos.logback.classic.spi.ILoggingEvent>() {
            protected void append(ch.qos.logback.classic.spi.ILoggingEvent entry) { logs.add(entry); }
        };
        appender.start(); logger.addAppender(appender);
        try {
            for (String mode : List.of("nack", "returned", "timeout", "exceptional", "send", "declaration")) {
                reset(rabbit, admin);
                if (mode.equals("declaration")) doThrow(new IllegalStateException("declaration failed")).when(admin).initialize();
                doAnswer(call -> {
                    if (mode.equals("send")) throw new IllegalStateException("send failed");
                    var correlation = call.getArgument(4, CorrelationData.class);
                    if (mode.equals("returned")) correlation.setReturned(new ReturnedMessage(new Message(new byte[0]),
                            312, "NO_ROUTE", RabbitMQConfig.ROOM_EVENTS_EXCHANGE, "room.timeline"));
                    if (mode.equals("exceptional")) correlation.getFuture().completeExceptionally(new IllegalStateException("channel closed"));
                    else if (!mode.equals("timeout")) correlation.getFuture().complete(new CorrelationData.Confirm(!mode.equals("nack"), "test nack"));
                    return null;
                }).when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
                assertThatCode(() -> publisher.onRoomTimeline(event)).doesNotThrowAnyException();
            }
            for (int i = 0; i < 100 && logs.size() < 6; i++) Thread.sleep(20);
            assertThat(logs).hasSize(6).allSatisfy(entry -> {
                assertThat(entry.getFormattedMessage()).contains("already committed", "may be lost", "no outbox",
                        event.eventId().toString(), "42", "MEMBER_KICKED");
                assertThat(entry.getLevel()).isEqualTo(ch.qos.logback.classic.Level.ERROR);
                assertThat(entry.getThrowableProxy()).isNotNull();
            });
            assertThat(logs).anySatisfy(entry -> assertThat(entry.getThrowableProxy().getMessage()).contains("NO_ROUTE"));
            assertThat(logs).anySatisfy(entry -> assertThat(entry.getThrowableProxy().getMessage()).contains("Broker nack"));
            assertThat(logs).anySatisfy(entry -> assertThat(entry.getThrowableProxy().getMessage()).contains("No broker confirm"));
        } finally { logger.detachAppender(appender); }
    }

    @Test
    void neverWaitsForConfirmation() {
        var slow = new RoomTimelinePublisher(rabbit, admin, 5000);
        assertThatCode(() -> org.junit.jupiter.api.Assertions.assertTimeout(java.time.Duration.ofSeconds(1),
                () -> slow.onRoomTimeline(event))).doesNotThrowAnyException();
        verify(rabbit).convertAndSend(anyString(), eq("room.timeline"), any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
    }

    @Test
    void durableTopologyKeepsExistingChatDeclarationsCompatible() throws Exception {
        var topology = new RabbitMQConfig().roomEventsTopology();
        var queues = topology.getDeclarablesByType(Queue.class);
        assertThat(queues).extracting(Queue::getName).containsExactlyInAnyOrder(
                "guildchat.chat-service.room-events", "guildchat.chat-service.room-events.dead", "guildchat.chat-service.room-timeline");
        assertThat(queues).allSatisfy(queue -> {
            assertThat(queue.isDurable()).isTrue();
            assertThat(queue.isExclusive()).isFalse();
            assertThat(queue.isAutoDelete()).isFalse();
            assertThat(queue.getArguments()).isEmpty();
        });
        assertThat(topology.getDeclarablesByType(DirectExchange.class)).allSatisfy(exchange -> {
            assertThat(exchange.isDurable()).isTrue();
            assertThat(exchange.isAutoDelete()).isFalse();
        });
        assertThat(topology.getDeclarablesByType(Binding.class)).anySatisfy(binding -> {
            assertThat(binding.getExchange()).isEqualTo("guildchat.room-events");
            assertThat(binding.getDestination()).isEqualTo("guildchat.chat-service.room-timeline");
            assertThat(binding.getRoutingKey()).isEqualTo("room.timeline");
        });
        // Chat is intentionally untouched and currently declares only the existing queues.
        var chat = java.nio.file.Files.readString(java.nio.file.Path.of("../chat-service/src/main/java/com/fttranscendence/chatservice/config/RabbitMQConfig.java"));
        assertThat(chat).contains("new DirectExchange(ROOM_EVENTS_EXCHANGE, true, false)",
                "QueueBuilder.durable(CHAT_ROOM_EVENTS_QUEUE).build()", "QueueBuilder.durable(DEAD_QUEUE).build()",
                "\"guildchat.room-events\"", "\"guildchat.chat-service.room-events\"", "\"guildchat.chat-service.room-events.dead\"");
    }
}
