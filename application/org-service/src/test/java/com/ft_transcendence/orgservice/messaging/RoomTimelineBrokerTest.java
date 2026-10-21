package com.ft_transcendence.orgservice.messaging;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.UUID;
import com.ft_transcendence.orgservice.config.RabbitMQConfig;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.service.RoomTimelineEvent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.*;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import tools.jackson.databind.json.JsonMapper;

/** Only against a fresh, disposable broker; never purge or consume application broker queues. */
@EnabledIfEnvironmentVariable(named = "ROOM_EVENTS_TEST_PORT", matches = "[0-9]+")
class RoomTimelineBrokerTest {
    @Test
    void queuesBeforeChatStartsAndPreservesDepartureSendOrder() {
        var factory = new CachingConnectionFactory("127.0.0.1", Integer.parseInt(System.getenv("ROOM_EVENTS_TEST_PORT")));
        factory.setUsername("room_test"); factory.setPassword("isolated_test_only");
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean("connectionFactory", CachingConnectionFactory.class, () -> factory);
            context.register(RabbitMQConfig.class);
            context.refresh();
            var admin = context.getBean(RabbitAdmin.class);
            admin.initialize();
            var queue = admin.getQueueInfo(RabbitMQConfig.CHAT_ROOM_TIMELINE_QUEUE);
            assertThat(queue).isNotNull();
            assertThat(queue.getMessageCount()).as("Use a fresh disposable broker").isZero();
            var rabbit = new RabbitTemplate(factory);
            rabbit.setMessageConverter(context.getBean(RabbitMQConfig.class).roomEventMessageConverter());
            rabbit.setMandatory(true);
            var publisher = new RoomTimelinePublisher(rabbit, admin, 5000);
            UUID owner = UUID.randomUUID();
            var left = new RoomTimelineEvent(UUID.randomUUID(), 1, RoomTimelineType.MEMBER_LEFT, 42L,
                    owner, owner, null, null, null, null, Instant.now());
            var transferred = new RoomTimelineEvent(UUID.randomUUID(), 1, RoomTimelineType.OWNERSHIP_TRANSFERRED,
                    42L, owner, UUID.randomUUID(), RoleName.OWNER, RoleName.ADMIN, null, null, Instant.now());
            publisher.onRoomTimeline(left);
            publisher.onRoomTimeline(transferred);
            for (var event : java.util.List.of(left, transferred)) {
                var message = rabbit.receive(RabbitMQConfig.CHAT_ROOM_TIMELINE_QUEUE, 5000);
                assertThat(message).isNotNull();
                var props = message.getMessageProperties();
                assertThat(props.getReceivedDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
                assertThat(props.getContentType()).isEqualTo("application/json");
                assertThat(props.getMessageId()).isEqualTo(event.eventId().toString());
                assertThat(props.getReceivedRoutingKey()).isEqualTo("room.timeline");
                assertThat(props.getHeaders()).doesNotContainKey("__TypeId__");
                var mapper = new JsonMapper();
                assertThat(mapper.readTree(message.getBody())).isEqualTo(
                        mapper.readTree(mapper.writeValueAsBytes(RoomTimelineMessage.from(event))));
            }
        }
    }
}
