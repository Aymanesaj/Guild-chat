package com.ft_transcendence.orgservice.config;

import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
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
    public JacksonJsonMessageConverter roomEventMessageConverter() {
        // Dedicated mapper: independent of HTTP naming rules and inferred from the listener record.
        return new JacksonJsonMessageConverter();
    }
}
