package com.fttranscendence.chatservice.messaging;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.amqp.RabbitAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.*;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.core.*;
import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.grpc.RoomMembersCache;
import com.fttranscendence.chatservice.repository.MessageRepository;
import com.fttranscendence.chatservice.websocket.ChatWebSocketHandler;

/** Only point ROOM_EVENTS_TEST_PORT at an isolated, disposable broker, never application data. */
@EnabledIfEnvironmentVariable(named = "ROOM_EVENTS_TEST_PORT", matches = "[0-9]+")
@SpringBootTest(classes = RoomEventsBrokerTest.Config.class, properties = {
        "spring.rabbitmq.host=127.0.0.1", "spring.rabbitmq.port=${ROOM_EVENTS_TEST_PORT}",
        "spring.rabbitmq.username=room_test", "spring.rabbitmq.password=isolated_test_only"
}, webEnvironment = SpringBootTest.WebEnvironment.NONE)
class RoomEventsBrokerTest {
    @Configuration(proxyBeanMethods = false)
    @Import({RabbitAutoConfiguration.class, RabbitMQConfig.class, RoomChangedConsumer.class})
    static class Config {
        @Bean ChatWebSocketHandler sockets() { return mock(ChatWebSocketHandler.class); }
        @Bean RoomMembersCache cache() { return mock(RoomMembersCache.class); }
        @Bean MessageRepository messages() { return mock(MessageRepository.class); }
    }
    @Autowired RabbitTemplate rabbit;
    @Autowired RabbitAdmin admin;
    @Autowired ChatWebSocketHandler sockets;
    @Autowired RoomMembersCache cache;
    @Autowired MessageRepository messages;

    private void send(String json) {
        var props = new MessageProperties();
        props.setContentType("application/json");
        props.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        rabbit.send(RabbitMQConfig.ROOM_EVENTS_EXCHANGE, "room.changed",
                new Message(json.getBytes(StandardCharsets.UTF_8), props));
    }
    private Message deadLetter() {
        Message dead = rabbit.receive(RabbitMQConfig.DEAD_QUEUE, 10000);
        assertThat(dead).isNotNull();
        assertThat(dead.getMessageProperties().getReceivedDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
        return dead;
    }
    @Test
    void actualJsonDeliveryAndBoundedRecoveryIncludeMalformedJsonAndListenerFailures() throws Exception {
        admin.initialize();
        // Producer-generated Jackson 3 messages are left by Org's test, without type headers.
        // Deserialize into Chat's own enum and preserve every frontend event name.
        var expected = Map.of(4242L, "room.added", 4243L, "room.updated", 4244L, "room.removed");
        expected.forEach((roomId, event) -> {
            verify(sockets, timeout(10000)).sendToUser(RoomChangedConsumerTest.ALICE, event, Map.of("room_id", roomId));
            verify(cache, timeout(10000)).invalidate(roomId);
        });
        verify(sockets).revokeRoom(RoomChangedConsumerTest.ALICE, 4244L);
        verifyNoInteractions(messages);
        clearInvocations(sockets, cache);
        send("""
                {"roomId":"42","change":"ROOM_UPDATED","userIds":["%s"],"roomDeleted":false}
                """.formatted(RoomChangedConsumerTest.ALICE));
        verify(sockets, timeout(10000)).sendToUser(RoomChangedConsumerTest.ALICE, "room.updated", Map.of("room_id", 42L));
        verify(cache, timeout(10000)).invalidate(42L);
        clearInvocations(sockets, cache);

        for (String invalid : List.of(
                "{\"roomId\":\"42\",\"change\":\"ROOM_CREATED\",\"userIds\":[],\"roomDeleted\":true}",
                "{\"roomId\":\"42\",\"userIds\":[],\"roomDeleted\":true}",
                "{\"roomId\":\"42\",\"change\":null,\"userIds\":[],\"roomDeleted\":true}",
                "{broken", """
                {"roomId":"42","change":"ROOM_REMOVED","userIds":["bad"],"roomDeleted":true}
                """)) {
            send(invalid);
            assertThat(new String(deadLetter().getBody(), StandardCharsets.UTF_8)).isEqualTo(invalid);
            verifyNoInteractions(sockets, cache, messages);
        }
        doThrow(new IllegalStateException("test database failure")).when(messages).deleteByRoomId(43L);
        send("""
                {"roomId":"43","change":"ROOM_REMOVED","userIds":[],"roomDeleted":true}
                """);
        deadLetter();
        verify(messages, times(3)).deleteByRoomId(43L);
        verifyNoInteractions(cache, sockets);
        assertThat(rabbit.receive(RabbitMQConfig.CHAT_ROOM_EVENTS_QUEUE, 1000)).isNull();
        assertThat(rabbit.receive(RabbitMQConfig.DEAD_QUEUE, 1000)).isNull();
    }
}
