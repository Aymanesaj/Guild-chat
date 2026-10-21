package com.ft_transcendence.orgservice.messaging;

import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.service.RoomTimelineEvent;

@Component
public class RoomTimelinePublisher {
    private static final Logger log = LoggerFactory.getLogger(RoomTimelinePublisher.class);
    private final RabbitTemplate rabbit;
    private final long confirmTimeoutMs;
    private final RabbitAdmin admin;

    public RoomTimelinePublisher(RabbitTemplate rabbit, RabbitAdmin admin,
            @Value("${room-events.confirm-timeout-ms:5000}") long confirmTimeoutMs) {
        this.rabbit = rabbit;
        this.admin = admin;
        this.confirmTimeoutMs = confirmTimeoutMs;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRoomTimeline(RoomTimelineEvent event) {
        try {
            // Connection/declaration and send are synchronous; only confirmation is asynchronous.
            admin.initialize();
            RoomTimelineMessage payload = RoomTimelineMessage.from(event);
            CorrelationData correlation = new CorrelationData(event.eventId().toString());
            rabbit.convertAndSend(RabbitMQConfig.ROOM_EVENTS_EXCHANGE,
                    RabbitMQConfig.ROOM_TIMELINE_ROUTING_KEY, payload, message -> {
                        message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                        message.getMessageProperties().setContentType("application/json");
                        message.getMessageProperties().setMessageId(event.eventId().toString());
                        // The schema carries no Java class identity.
                        message.getMessageProperties().getHeaders().remove("__TypeId__");
                        return message;
                    }, correlation);
            // Do not wait for the confirm on the request thread.
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
                            log.debug("Broker confirmed timeline event eventId={} roomId={} type={}; Chat delivery is not confirmed",
                                    event.eventId(), event.roomId(), event.type());
                        }
                    });
        } catch (Exception failure) {
            logLost(event, failure);
        }
    }

    private static void logLost(RoomTimelineEvent event, Exception failure) {
        // The business transaction ALREADY committed. Never turn this into an HTTP failure.
        log.error("Room mutation already committed; notification publication failed or is unconfirmed "
                + "for eventId={} roomId={} type={}. Event may be lost (no outbox)",
                event.eventId(), event.roomId(), event.type(), failure);
    }
}
