package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * Frame handling over real sockets: a client sends text, the server answers
 * with frames. Proves the envelope and that a bad frame is reported rather
 * than closing the connection.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketFrameTest extends MongoTestSupport {

    private static final String ALICE_TOKEN = "alice.token";
    private static final String BOB_TOKEN = "bob.token";
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b111c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @LocalServerPort
    private int port;

    @MockBean
    private IdentityClient identityClient;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final StandardWebSocketClient client = new StandardWebSocketClient();

    /** A client that records every frame the server sends it. */
    private static final class RecordingClient extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.add(message.getPayload());
        }

        /** Null when nothing arrives within the timeout. */
        String nextFrame() throws InterruptedException {
            return frames.poll(3, TimeUnit.SECONDS);
        }

        boolean receivedNothing() throws InterruptedException {
            return frames.poll(500, TimeUnit.MILLISECONDS) == null;
        }
    }

    private RecordingClient aliceClient;
    private WebSocketSession alice;

    @BeforeEach
    void connectAlice() throws Exception {
        when(identityClient.validateToken(ALICE_TOKEN)).thenReturn(Optional.of(ALICE));

        aliceClient = new RecordingClient();
        alice = client.execute(aliceClient, "ws://localhost:" + port + "/ws/chat?token=" + ALICE_TOKEN)
                .get(5, TimeUnit.SECONDS);
    }

    @AfterEach
    void closeAlice() throws Exception {
        if (alice != null && alice.isOpen()) {
            alice.close();
        }
    }

    private JsonNode send(String payload) throws Exception {
        alice.sendMessage(new TextMessage(payload));
        String frame = aliceClient.nextFrame();
        assertThat(frame).as("expected a frame in reply to %s", payload).isNotNull();
        return objectMapper.readTree(frame);
    }

    @Test
    @DisplayName("malformed JSON gets an error frame, and the connection stays open")
    void malformedJsonIsReported() throws Exception {
        JsonNode reply = send("this is not json");

        assertThat(reply.path("event").asText()).isEqualTo("error");
        assertThat(reply.path("data").path("code").asText()).isEqualTo("INVALID_JSON");
        assertThat(alice.isOpen()).as("a client typo must not cost the user every room").isTrue();
    }

    @Test
    @DisplayName("a frame without 'event' gets MISSING_EVENT")
    void missingEventIsReported() throws Exception {
        JsonNode reply = send("{\"data\":{\"room_id\":42}}");

        assertThat(reply.path("data").path("code").asText()).isEqualTo("MISSING_EVENT");
        assertThat(alice.isOpen()).isTrue();
    }

    @Test
    @DisplayName("an unknown event gets UNKNOWN_EVENT naming it")
    void unknownEventIsReported() throws Exception {
        JsonNode reply = send("{\"event\":\"delete.everything\",\"data\":{}}");

        assertThat(reply.path("data").path("code").asText()).isEqualTo("UNKNOWN_EVENT");
        assertThat(reply.path("data").path("message").asText()).contains("delete.everything");
    }

    @Test
    @DisplayName("an empty event name is rejected, not treated as an unknown event")
    void blankEventIsReported() throws Exception {
        JsonNode reply = send("{\"event\":\"  \",\"data\":{}}");

        assertThat(reply.path("data").path("code").asText()).isEqualTo("MISSING_EVENT");
    }

    @Test
    @DisplayName("error frames use the {event, data:{code, message}} envelope")
    void errorFrameShape() throws Exception {
        JsonNode reply = send("nonsense");

        assertThat(reply.has("event")).isTrue();
        assertThat(reply.has("data")).isTrue();
        assertThat(reply.path("data").has("code")).isTrue();
        assertThat(reply.path("data").has("message")).isTrue();
        assertThat(reply.size()).as("no extra top-level keys").isEqualTo(2);
    }

    @Test
    @DisplayName("subscribe and unsubscribe are accepted silently for now (no error frame)")
    void knownEventsProduceNoError() throws Exception {
        alice.sendMessage(new TextMessage("{\"event\":\"subscribe\",\"data\":{\"room_id\":42}}"));
        assertThat(aliceClient.receivedNothing()).isTrue();

        alice.sendMessage(new TextMessage("{\"event\":\"unsubscribe\",\"data\":{\"room_id\":42}}"));
        assertThat(aliceClient.receivedNothing()).isTrue();

        assertThat(alice.isOpen()).isTrue();
    }

    @Test
    @DisplayName("one client's bad frame does not disturb another client")
    void errorsAreScopedToTheSenderSocket() throws Exception {
        when(identityClient.validateToken(BOB_TOKEN)).thenReturn(Optional.of(BOB));

        RecordingClient bobClient = new RecordingClient();
        WebSocketSession bob = client
                .execute(bobClient, "ws://localhost:" + port + "/ws/chat?token=" + BOB_TOKEN)
                .get(5, TimeUnit.SECONDS);

        try {
            JsonNode aliceReply = send("{\"event\":\"bogus\"}");

            assertThat(aliceReply.path("data").path("code").asText()).isEqualTo("UNKNOWN_EVENT");
            assertThat(bobClient.receivedNothing()).as("Bob must not see Alice's error").isTrue();
            assertThat(bob.isOpen()).isTrue();
        } finally {
            bob.close();
        }
    }
}
