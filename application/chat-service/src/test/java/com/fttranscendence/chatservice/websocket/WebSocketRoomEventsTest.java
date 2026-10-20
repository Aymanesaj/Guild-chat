package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.messaging.RoomChangedConsumer;
import com.fttranscendence.chatservice.messaging.RoomChangedMessage;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;


/**
 * The whole path for user-level events, with no room subscription anywhere:
 *   - converted AMQP event (consumer invoked directly) → room.added on every tab
 *   - a REST POST → room.activity on a member who has no room open
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketRoomEventsTest extends MongoTestSupport {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    /** Rooms no other test class uses: cached contexts share RoomMembersCache. */
    private static final long ROOM = 720L;
    private static final long ACTIVITY_ROOM = 721L;
    private static final long KICK_ROOM = 722L;

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private RoomChangedConsumer consumer;

    @Autowired
    private org.springframework.amqp.support.converter.Jackson2JsonMessageConverter converter;

    @Autowired
    private ChatWebSocketHandler handler;

    @Autowired
    private SubscriptionRegistry subscriptions;

    @MockBean
    private IdentityClient identityClient;

    @MockBean
    private OrgClient orgClient;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final StandardWebSocketClient client = new StandardWebSocketClient();
    private final List<WebSocketSession> opened = new ArrayList<>();

    private static final class RecordingClient extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.add(message.getPayload());
        }
    }

    @BeforeEach
    void setUp() {
        when(identityClient.validateToken(anyString())).thenReturn(Optional.empty());
        when(identityClient.validateToken(ALICE + ".token")).thenReturn(Optional.of(ALICE));
        when(identityClient.validateToken(BOB + ".token")).thenReturn(Optional.of(BOB));
        when(orgClient.isMember(anyString(), anyLong())).thenReturn(true);

    }

    @AfterEach
    void cleanUp() throws Exception {
        for (WebSocketSession session : opened) {
            if (session.isOpen()) {
                session.close();
            }
        }
        awaitConnections(ALICE, 0);
        awaitConnections(BOB, 0);
    }

    private RecordingClient connect(String userId) throws Exception {
        RecordingClient recorder = new RecordingClient();
        opened.add(client
                .execute(recorder, "ws://localhost:" + port + "/ws/chat?token=" + userId + ".token")
                .get(5, TimeUnit.SECONDS));
        return recorder;
    }

    /** The server registers a socket after the client's handshake completes: wait for it. */
    private void awaitConnections(String userId, int expected) throws Exception {
        for (int attempt = 0; attempt < 50 && handler.connectionCount(userId) != expected; attempt++) {
            Thread.sleep(100);
        }
        assertThat(handler.connectionCount(userId)).as("sockets of %s", userId).isEqualTo(expected);
    }

    private JsonNode nextFrame(RecordingClient tab) throws Exception {
        String frame = tab.frames.poll(3, TimeUnit.SECONDS);
        assertThat(frame).as("expected a frame").isNotNull();
        return objectMapper.readTree(frame);
    }

    private boolean receivesNothing(RecordingClient tab) throws Exception {
        return tab.frames.poll(500, TimeUnit.MILLISECONDS) == null;
    }

    @Test
    @DisplayName("org's RoomChanged reaches every tab of each listed user, and nobody else")
    void roomChangedReachesListedUsers() throws Exception {
        RecordingClient bobTab1 = connect(BOB);
        RecordingClient bobTab2 = connect(BOB);
        RecordingClient alice = connect(ALICE);
        awaitConnections(BOB, 2);
        awaitConnections(ALICE, 1);

        var properties = new org.springframework.amqp.core.MessageProperties();
        properties.setInferredArgumentType(RoomChangedMessage.class);
        properties.setContentType("application/json");
        byte[] json = ("{\"roomId\":\"" + ROOM + "\",\"change\":\"ROOM_ADDED\","
                + "\"userIds\":[\"" + BOB + "\"],\"roomDeleted\":false}")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        consumer.consume((RoomChangedMessage) converter.fromMessage(
                new org.springframework.amqp.core.Message(json, properties)));

        for (RecordingClient tab : List.of(bobTab1, bobTab2)) {
            JsonNode frame = nextFrame(tab);
            assertThat(frame.path("event").asText()).isEqualTo("room.added");
            assertThat(frame.path("data").path("room_id").asLong()).isEqualTo(ROOM);
        }
        assertThat(receivesNothing(alice)).isTrue();
    }

    @Test
    @DisplayName("a removed user's open socket stops receiving the room's messages")
    void removalEndsTheLiveFeed() throws Exception {
        RecordingClient bob = connect(BOB);
        awaitConnections(BOB, 1);
        opened.get(opened.size() - 1).sendMessage(new TextMessage(
                "{\"event\":\"subscribe\",\"data\":{\"room_id\":" + KICK_ROOM + "}}"));
        awaitSubscribers(KICK_ROOM, 1);

        consumer.consume(new RoomChangedMessage(String.valueOf(KICK_ROOM), "ROOM_REMOVED", List.of(BOB), false));

        JsonNode removed = nextFrame(bob);
        assertThat(removed.path("event").asText()).isEqualTo("room.removed");
        assertThat(subscriptions.sessionsIn(KICK_ROOM)).as("subscription revoked").isEmpty();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(ALICE + ".token");
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> response = rest.postForEntity("/rooms/" + KICK_ROOM + "/messages",
                new HttpEntity<>("{\"content\":\"after the kick\"}", headers), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        assertThat(receivesNothing(bob)).as("no message.new after removal").isTrue();
    }

    private void awaitSubscribers(long roomId, int expected) throws Exception {
        for (int attempt = 0; attempt < 50 && subscriptions.subscriberCount(roomId) != expected; attempt++) {
            Thread.sleep(100);
        }
        assertThat(subscriptions.subscriberCount(roomId)).as("subscribers of %s", roomId).isEqualTo(expected);
    }

    @Test
    @DisplayName("a POST reaches a member with no room open as room.activity")
    void postReachesUnsubscribedMember() throws Exception {
        when(orgClient.memberIds(eq(ACTIVITY_ROOM), anyString())).thenReturn(List.of(ALICE, BOB));
        RecordingClient bob = connect(BOB);
        awaitConnections(BOB, 1);

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(ALICE + ".token");
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> response = rest.postForEntity("/rooms/" + ACTIVITY_ROOM + "/messages",
                new HttpEntity<>("{\"content\":\"preview me\"}", headers), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        JsonNode frame = nextFrame(bob);
        assertThat(frame.path("event").asText()).isEqualTo("room.activity");
        JsonNode data = frame.path("data");
        assertThat(data.path("room_id").asLong()).isEqualTo(ACTIVITY_ROOM);
        assertThat(data.path("change").asText()).isEqualTo("new");
        assertThat(data.path("message")).as("same JSON as the REST body")
                .isEqualTo(objectMapper.readTree(response.getBody()));
    }
}
