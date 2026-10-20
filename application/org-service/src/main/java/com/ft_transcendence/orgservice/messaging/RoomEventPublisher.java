package com.ft_transcendence.orgservice.messaging;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.service.RoomChangedEvent;

@Component
public class RoomEventPublisher {
    private static final Logger log = LoggerFactory.getLogger(RoomEventPublisher.class);
    private final RabbitTemplate rabbit;
    private final long confirmTimeoutMs;

    public RoomEventPublisher(RabbitTemplate rabbit,
            @Value("${room-events.confirm-timeout-ms:5000}") long confirmTimeoutMs) {
        this.rabbit = rabbit;
        this.confirmTimeoutMs = confirmTimeoutMs;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRoomChanged(RoomChangedEvent event) {
        try {
            // Topology is declared by the RabbitAdmin bean on every (re)connect, not per publication.
            RoomChangedMessage payload = new RoomChangedMessage(event.roomId().toString(),
                    event.change().name(), event.userIds().stream().map(UUID::toString).toList(),
                    event.roomDeleted());
            CorrelationData correlation = new CorrelationData(UUID.randomUUID().toString());
            rabbit.convertAndSend(RabbitMQConfig.ROOM_EVENTS_EXCHANGE,
                    RabbitMQConfig.ROOM_CHANGED_ROUTING_KEY, payload, message -> {
                        message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                        // The schema carries no Java class identity.
                        message.getMessageProperties().getHeaders().remove("__TypeId__");
                        return message;
                    }, correlation);
            // Never block the HTTP request on the broker: the confirm is checked when it arrives.
            correlation.getFuture()
                    .orTimeout(confirmTimeoutMs, TimeUnit.MILLISECONDS)
                    .whenComplete((confirm, error) -> {
                        Exception failure = error != null
                                ? new IllegalStateException("No broker confirm", error)
                                : !confirm.ack()
                                        ? new IllegalStateException("Broker nack: " + confirm.reason())
                                        : correlation.getReturned() != null
                                                ? new IllegalStateException("Unroutable publication: "
                                                        + correlation.getReturned().getReplyText())
                                                : null;
                        if (failure != null) {
                            logLost(event, failure);
                        } else {
                            log.debug("Broker confirmed room event room={} change={}; Chat/browser delivery is not confirmed",
                                    event.roomId(), event.change());
                        }
                    });
        } catch (Exception failure) {
            logLost(event, failure);
        }
    }

    private static void logLost(RoomChangedEvent event, Exception failure) {
        // The business transaction ALREADY committed. Never turn this into an HTTP failure.
        log.error("Room mutation already committed; notification publication failed or is unconfirmed "
                + "for room={} change={}. Notification may be lost (no outbox)",
                event.roomId(), event.change(), failure);
    }
}
