package com.fttranscendence.chatservice.config;

import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory.ConfirmType;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.retry.MessageRecoverer;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecovererWithConfirms;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {
    public static final String ROOM_EVENTS_EXCHANGE = "guildchat.room-events";
    public static final String CHAT_ROOM_EVENTS_QUEUE = "guildchat.chat-service.room-events";
    public static final String ROOM_CHANGED_ROUTING_KEY = "room.changed";
    public static final String DEAD_EXCHANGE = "guildchat.room-events.dead";
    public static final String DEAD_QUEUE = "guildchat.chat-service.room-events.dead";

    @Bean
    public Declarables roomEventsTopology() {
        DirectExchange exchange = new DirectExchange(ROOM_EVENTS_EXCHANGE, true, false);
        DirectExchange deadExchange = new DirectExchange(DEAD_EXCHANGE, true, false);
        Queue queue = QueueBuilder.durable(CHAT_ROOM_EVENTS_QUEUE).build();
        Queue deadQueue = QueueBuilder.durable(DEAD_QUEUE).build();
        return new Declarables(exchange, deadExchange, queue, deadQueue,
                BindingBuilder.bind(queue).to(exchange).with(ROOM_CHANGED_ROUTING_KEY),
                BindingBuilder.bind(deadQueue).to(deadExchange).with(ROOM_CHANGED_ROUTING_KEY));
    }

    @Bean
    public Jackson2JsonMessageConverter roomEventMessageConverter() {
        // Dedicated mapper: independent of HTTP naming rules and inferred from the listener record.
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public MessageRecoverer roomEventRecoverer(RabbitTemplate rabbit) {
        // Built-in bounded-retry recovery, including conversion failures. Republishing avoids
        // changing arguments on the owner's existing queue (which RabbitMQ would reject).
        var recoverer = new RepublishMessageRecovererWithConfirms(
                rabbit, DEAD_EXCHANGE, ROOM_CHANGED_ROUTING_KEY,
                ConfirmType.CORRELATED);
        recoverer.setConfirmTimeout(5000);
        recoverer.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return recoverer;
    }
}
