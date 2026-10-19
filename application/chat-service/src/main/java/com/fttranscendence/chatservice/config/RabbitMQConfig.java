
package com.fttranscendence.chatservice.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {

    public static final String ROOM_EVENTS_EXCHANGE =
            "guildchat.room-events";

    public static final String CHAT_ROOM_EVENTS_QUEUE =
            "guildchat.chat-service.room-events";

    public static final String ROOM_CHANGED_ROUTING_KEY =
            "room.changed";

    @Bean
    public DirectExchange roomEventsExchange() {
        return new DirectExchange(
                ROOM_EVENTS_EXCHANGE,
                true,
                false
        );
    }

    @Bean
    public Queue chatRoomEventsQueue() {
        return QueueBuilder
                .durable(CHAT_ROOM_EVENTS_QUEUE)
                .build();
    }

    @Bean
    public Binding chatRoomEventsBinding(
            Queue chatRoomEventsQueue,
            DirectExchange roomEventsExchange) {

        return BindingBuilder
                .bind(chatRoomEventsQueue)
                .to(roomEventsExchange)
                .with(ROOM_CHANGED_ROUTING_KEY);
    }
}
