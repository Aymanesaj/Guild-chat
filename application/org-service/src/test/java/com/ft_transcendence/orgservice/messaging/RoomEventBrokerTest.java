package com.ft_transcendence.orgservice.messaging;

import static org.assertj.core.api.Assertions.*;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.*;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.service.RoomChangedEvent;
import com.fttranscendence.chat.grpc.RoomChange;

/** Run before Chat's RoomEventsBrokerTest against the SAME disposable broker. */
@EnabledIfEnvironmentVariable(named = "ROOM_EVENTS_TEST_PORT", matches = "[0-9]+")
class RoomEventBrokerTest {
    @Test
    void declaresBeforeChatStartsConfirmsPersistentJsonAndDetectsUnroutable() throws Exception {
        var factory = new CachingConnectionFactory("127.0.0.1", Integer.parseInt(System.getenv("ROOM_EVENTS_TEST_PORT")));
        factory.setUsername("room_test"); factory.setPassword("isolated_test_only");
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean("connectionFactory", CachingConnectionFactory.class, () -> factory);
            context.register(RabbitMQConfig.class);
            var admin = new RabbitAdmin(factory);
            context.registerBean("rabbitAdmin", RabbitAdmin.class, () -> admin);
            context.refresh();
            var rabbit = new RabbitTemplate(factory);
            rabbit.setMessageConverter(context.getBean(RabbitMQConfig.class).roomEventMessageConverter());
            rabbit.setMandatory(true);
            var publisher = new RoomEventPublisher(rabbit, admin, 5000);
            var alice = UUID.fromString("a215c5f8-d810-4518-ad4c-8d551eb6dfc4");
            var event = new RoomChangedEvent(4242L, RoomChange.ROOM_UPDATED, Set.of(alice));
            publisher.onRoomChanged(event);
            var wire = rabbit.receive(RabbitMQConfig.CHAT_ROOM_EVENTS_QUEUE, 5000);
            assertThat(wire).isNotNull();
            assertThat(wire.getMessageProperties().getReceivedDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
            assertThat(wire.getMessageProperties().getHeaders()).doesNotContainKey("__TypeId__");
            // Leave an actual Org/Jackson 3 publication for Chat/Jackson 2 to consume next.
            publisher.onRoomChanged(event);

            var returned = new org.springframework.amqp.rabbit.connection.CorrelationData("unroutable-test");
            rabbit.convertAndSend(RabbitMQConfig.ROOM_EVENTS_EXCHANGE, "no-such-route",
                    new RoomChangedMessage("42", "ROOM_UPDATED", java.util.List.of(alice.toString()), false), returned);
            assertThat(returned.getFuture().get(5, java.util.concurrent.TimeUnit.SECONDS).ack()).isTrue();
            assertThat(returned.getReturned()).isNotNull();
            assertThat(returned.getReturned().getReplyText()).isEqualTo("NO_ROUTE");
        }
    }
}
