package com.ft_transcendence.orgservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.*;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.service.RoomChangedEvent;
import com.fttranscendence.chat.grpc.RoomChange;

class RoomEventPublisherTest {
    final RabbitTemplate rabbit = mock(RabbitTemplate.class);
    final RoomEventPublisher publisher = new RoomEventPublisher(rabbit, 10);
    final RoomChangedEvent event = new RoomChangedEvent(42L, RoomChange.ROOM_UPDATED, Set.of(UUID.randomUUID()));

    @Test
    void jsonContractAndPersistentMessageHaveNoPackageDependency() {
        doAnswer(call -> {
            var body = call.getArgument(2, RoomChangedMessage.class);
            var message = new RabbitMQConfig().roomEventMessageConverter().toMessage(body, new MessageProperties());
            var processed = call.getArgument(3, MessagePostProcessor.class).postProcessMessage(message);
            assertThat(processed.getMessageProperties().getContentType()).contains("json");
            assertThat(processed.getMessageProperties().getDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
            assertThat(processed.getMessageProperties().getHeaders()).doesNotContainKey("__TypeId__");
            var json = new tools.jackson.databind.json.JsonMapper().readTree(processed.getBody());
            assertThat(json.propertyNames()).containsExactlyInAnyOrder("roomId", "change", "userIds", "roomDeleted");
            assertThat(json.path("roomId").isString()).isTrue();
            assertThat(json.path("roomId").asString()).isEqualTo("42");
            call.getArgument(4, CorrelationData.class).getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(rabbit).convertAndSend(eq(RabbitMQConfig.ROOM_EVENTS_EXCHANGE), eq("room.changed"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
        publisher.onRoomChanged(event);
        verify(rabbit).convertAndSend(eq(RabbitMQConfig.ROOM_EVENTS_EXCHANGE), eq("room.changed"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
    }

    @Test
    void failuresAreLoggedWithoutFailingTheAlreadyCommittedOperation() throws Exception {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(RoomEventPublisher.class);
        var logs = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            for (String mode : java.util.List.of("nack", "returned", "timeout", "connection")) {
                reset(rabbit);
                doAnswer(call -> {
                    if (mode.equals("connection")) throw new IllegalStateException("connection refused");
                    var correlation = call.getArgument(4, CorrelationData.class);
                    if (mode.equals("returned")) correlation.setReturned(new ReturnedMessage(
                            new Message(new byte[0]), 312, "NO_ROUTE", "guildchat.room-events", "room.changed"));
                    if (!mode.equals("timeout")) correlation.getFuture().complete(
                            new CorrelationData.Confirm(!mode.equals("nack"), "test nack"));
                    return null;
                }).when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class),
                        any(MessagePostProcessor.class), any(CorrelationData.class));
                assertThatCode(() -> publisher.onRoomChanged(event)).doesNotThrowAnyException();
            }
            // The missing confirm is reported asynchronously, after the 10 ms timeout.
            for (int i = 0; i < 100 && logs.list.size() < 4; i++) Thread.sleep(20);
            assertThat(logs.list).hasSize(4).allSatisfy(entry -> {
                assertThat(entry.getFormattedMessage()).contains("already committed", "may be lost", "no outbox");
                assertThat(entry.getLevel()).isEqualTo(ch.qos.logback.classic.Level.ERROR);
                assertThat(entry.getThrowableProxy()).isNotNull();
            });
            assertThat(logs.list.get(1).getThrowableProxy().getMessage()).contains("Unroutable", "NO_ROUTE");
        } finally { logger.detachAppender(logs); }
    }

    @Test
    void publishingDoesNotWaitForTheBrokerConfirm() {
        // A confirm that never arrives must not hold the request thread for the timeout.
        var slow = new RoomEventPublisher(rabbit, 5_000);
        long started = System.nanoTime();
        slow.onRoomChanged(event);
        assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofSeconds(1));
        verify(rabbit).convertAndSend(eq(RabbitMQConfig.ROOM_EVENTS_EXCHANGE), eq("room.changed"),
                any(Object.class), any(MessagePostProcessor.class), any(CorrelationData.class));
    }
}
