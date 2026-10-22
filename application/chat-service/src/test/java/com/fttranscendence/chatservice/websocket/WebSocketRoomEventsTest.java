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
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.config.RabbitMQConfig;
import com.fttranscendence.chatservice.messaging.FriendshipEvent;
import com.fttranscendence.chatservice.messaging.FriendshipEventConsumer;
import com.fttranscendence.chatservice.messaging.FriendshipEventType;
import com.fttranscendence.chatservice.messaging.RoomChangedConsumer;
import com.fttranscendence.chatservice.messaging.RoomChangedMessage;
import com.fttranscendence.chatservice.messaging.RoomChange;
import com.fttranscendence.chatservice.messaging.RoomTimelineConsumer;
import com.fttranscendence.chatservice.messaging.RoomTimelineMessage;
import com.fttranscendence.chatservice.messaging.RoomTimelineType;
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
    private static final long TIMELINE_ROOM = 723L;
    private static final String CAROL = "c0000000-0000-4000-8000-000000000003";

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private RoomChangedConsumer consumer;

    @Autowired
    private FriendshipEventConsumer friendships;

    @Autowired
    private RoomTimelineConsumer timeline;

    @Autowired
    private org.springframework.amqp.rabbit.listener.RabbitListenerEndpointRegistry listeners;

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

        consumer.consume(new RoomChangedMessage(String.valueOf(KICK_ROOM), RoomChange.ROOM_REMOVED, List.of(BOB), false));

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
    @DisplayName("a friend request reaches the addressee's tabs and the requester's other tabs")
    void friendRequestReachesBothUsers() throws Exception {
        RecordingClient alice = connect(ALICE);
        RecordingClient bob = connect(BOB);
        awaitConnections(ALICE, 1);
        awaitConnections(BOB, 1);
        String friendship = "0f8fad5b-d9cb-469f-a165-70867728950e";

        friendships.consume(new FriendshipEvent("7c9e6679-7425-40de-944b-e07fc1f90ae7",
                FriendshipEventType.FRIEND_REQUEST_SENT, 1, friendship, ALICE, BOB, "2026-10-21T10:00:00.000Z"));

        JsonNode received = nextFrame(bob);
        assertThat(received.path("event").asText()).isEqualTo("friend.request.received");
        assertThat(received.path("data").path("friendship_id").asText()).isEqualTo(friendship);
        assertThat(received.path("data").path("user_id").asText()).isEqualTo(ALICE);

        JsonNode sent = nextFrame(alice);
        assertThat(sent.path("event").asText()).isEqualTo("friend.request.sent");
        assertThat(sent.path("data").path("user_id").asText()).isEqualTo(BOB);
    }

    @Test
    @DisplayName("the friendship queue has a registered listener, not just a declared queue")
    void friendshipQueueIsConsumed() {
        assertThat(listeners.getListenerContainers())
                .flatExtracting(container -> List.of(
                        ((org.springframework.amqp.rabbit.listener.AbstractMessageListenerContainer) container)
                                .getQueueNames()))
                .contains(RabbitMQConfig.CHAT_FRIENDSHIP_EVENTS_QUEUE, RabbitMQConfig.CHAT_ROOM_EVENTS_QUEUE,
                        RabbitMQConfig.CHAT_ROOM_TIMELINE_QUEUE);
    }

    @Test
    @DisplayName("a room event from org is stored, pushed live as message.new, and returned by history")
    void timelineEventIsPersistedAndPushed() throws Exception {
        RecordingClient bob = connect(BOB);
        awaitConnections(BOB, 1);
        opened.get(opened.size() - 1).sendMessage(new TextMessage(
                "{\"event\":\"subscribe\",\"data\":{\"room_id\":" + TIMELINE_ROOM + "}}"));
        awaitSubscribers(TIMELINE_ROOM, 1);
        // Unique per run: the event_id index is shared by every test using this database.
        String eventId = java.util.UUID.randomUUID().toString();
        RoomTimelineMessage kicked = new RoomTimelineMessage(eventId, 1, RoomTimelineType.MEMBER_KICKED,
                String.valueOf(TIMELINE_ROOM), ALICE, CAROL, null, null, null, null, "2026-10-22T10:00:00.123Z");

        timeline.consume(kicked);

        JsonNode frame = nextFrame(bob);
        assertThat(frame.path("event").asText()).isEqualTo("message.new");
        JsonNode pushed = frame.path("data");
        assertThat(pushed.path("content_type").asText()).isEqualTo("system");
        assertThat(pushed.path("sender_id").isNull()).isTrue();
        assertThat(pushed.path("system").path("type").asText()).isEqualTo("MEMBER_KICKED");
        assertThat(pushed.path("system").path("actor_id").asText()).isEqualTo(ALICE);
        assertThat(pushed.path("system").path("target_id").asText()).isEqualTo(CAROL);

        // Redelivery: stored once, pushed once.
        timeline.consume(kicked);
        assertThat(receivesNothing(bob)).as("no second message.new for a redelivered event").isTrue();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(BOB + ".token");
        ResponseEntity<String> history = rest.exchange("/rooms/" + TIMELINE_ROOM + "/messages",
                HttpMethod.GET, new HttpEntity<>(headers), String.class);
        assertThat(history.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode page = objectMapper.readTree(history.getBody());
        List<JsonNode> systemMessages = new ArrayList<>();
        page.forEach(message -> {
            if ("system".equals(message.path("content_type").asText())) {
                systemMessages.add(message);
            }
        });
        assertThat(systemMessages).as("the event appears in history exactly once").hasSize(1);
        assertThat(systemMessages.get(0)).as("history returns what was pushed").isEqualTo(pushed);
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
