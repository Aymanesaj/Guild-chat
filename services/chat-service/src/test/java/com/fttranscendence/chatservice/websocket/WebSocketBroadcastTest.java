package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
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
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * The whole path: a REST POST is stored in a real MongoDB and arrives as
 * message.new on the subscribed sockets, and only on them.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketBroadcastTest extends MongoTestSupport {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    /** Rooms the other WebSocket test classes don't use: they share this context. */
    private static final long ROOM = 700L;
    private static final long OTHER_ROOM = 701L;

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

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

    /** A connected socket and the frames it received. */
    private record Tab(WebSocketSession session, RecordingClient recorder) {
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
        awaitSubscribers(ROOM, 0);
        awaitSubscribers(OTHER_ROOM, 0);
    }

    private Tab connect(String userId) throws Exception {
        RecordingClient recorder = new RecordingClient();
        WebSocketSession session = client
                .execute(recorder, "ws://localhost:" + port + "/ws/chat?token=" + userId + ".token")
                .get(5, TimeUnit.SECONDS);
        opened.add(session);
        return new Tab(session, recorder);
    }

    private void subscribe(Tab tab, long roomId) throws Exception {
        tab.session().sendMessage(new TextMessage(
                "{\"event\":\"subscribe\",\"data\":{\"room_id\":" + roomId + "}}"));
    }

    private void unsubscribe(Tab tab, long roomId) throws Exception {
        tab.session().sendMessage(new TextMessage(
                "{\"event\":\"unsubscribe\",\"data\":{\"room_id\":" + roomId + "}}"));
    }

    private ResponseEntity<String> post(String userId, long roomId, String content) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(userId + ".token");
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.postForEntity("/rooms/" + roomId + "/messages",
                new HttpEntity<>("{\"content\":\"" + content + "\"}", headers), String.class);
    }

    /** Frames are handled asynchronously, so poll rather than sleep blindly. */
    private void awaitSubscribers(long roomId, int expected) throws Exception {
        for (int attempt = 0; attempt < 50 && subscriptions.subscriberCount(roomId) != expected; attempt++) {
            Thread.sleep(100);
        }
        assertThat(subscriptions.subscriberCount(roomId)).as("subscribers in room %s", roomId).isEqualTo(expected);
    }

    private JsonNode nextFrame(Tab tab) throws Exception {
        String frame = tab.recorder().frames.poll(3, TimeUnit.SECONDS);
        assertThat(frame).as("expected a frame").isNotNull();
        return objectMapper.readTree(frame);
    }

    private boolean receivesNothing(Tab tab) throws Exception {
        return tab.recorder().frames.poll(500, TimeUnit.MILLISECONDS) == null;
    }

    @Test
    @DisplayName("a POST reaches another subscribed member as message.new, identical to the REST body")
    void postIsBroadcastToSubscribers() throws Exception {
        Tab bob = connect(BOB);
        subscribe(bob, ROOM);
        awaitSubscribers(ROOM, 1);

        ResponseEntity<String> response = post(ALICE, ROOM, "hello bob");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        JsonNode created = objectMapper.readTree(response.getBody());

        JsonNode frame = nextFrame(bob);
        assertThat(frame.path("event").asText()).isEqualTo("message.new");
        JsonNode data = frame.path("data");
        assertThat(data).as("same JSON as the REST body, snake_case included").isEqualTo(created);
        assertThat(data.path("room_id").asLong()).isEqualTo(ROOM);
        assertThat(data.path("sender_id").asText()).isEqualTo(ALICE);
        assertThat(data.path("content").asText()).isEqualTo("hello bob");
    }

    @Test
    @DisplayName("the sender's own tabs receive it too, so a second tab stays in sync")
    void senderTabsReceiveTheirOwnMessage() throws Exception {
        Tab tab1 = connect(ALICE);
        Tab tab2 = connect(ALICE);
        subscribe(tab1, ROOM);
        subscribe(tab2, ROOM);
        awaitSubscribers(ROOM, 2);

        post(ALICE, ROOM, "from tab 1");

        assertThat(nextFrame(tab1).path("data").path("content").asText()).isEqualTo("from tab 1");
        assertThat(nextFrame(tab2).path("data").path("content").asText()).isEqualTo("from tab 1");
    }

    @Test
    @DisplayName("a socket subscribed to a different room receives nothing")
    void otherRoomReceivesNothing() throws Exception {
        Tab bob = connect(BOB);
        subscribe(bob, OTHER_ROOM);
        awaitSubscribers(OTHER_ROOM, 1);

        post(ALICE, ROOM, "not for you");

        assertThat(receivesNothing(bob)).isTrue();
    }

    @Test
    @DisplayName("a connected but unsubscribed socket receives nothing")
    void connectedWithoutSubscribeReceivesNothing() throws Exception {
        Tab bob = connect(BOB);

        post(ALICE, ROOM, "nobody listening");

        assertThat(receivesNothing(bob)).isTrue();
    }

    @Test
    @DisplayName("after unsubscribe, messages stop arriving")
    void unsubscribeStopsDelivery() throws Exception {
        Tab bob = connect(BOB);
        subscribe(bob, ROOM);
        awaitSubscribers(ROOM, 1);
        unsubscribe(bob, ROOM);
        awaitSubscribers(ROOM, 0);

        post(ALICE, ROOM, "too late");

        assertThat(receivesNothing(bob)).isTrue();
    }

    @Test
    @DisplayName("a rejected POST broadcasts nothing")
    void rejectedPostBroadcastsNothing() throws Exception {
        Tab bob = connect(BOB);
        subscribe(bob, ROOM);
        awaitSubscribers(ROOM, 1);

        ResponseEntity<String> response = post(ALICE, ROOM, "");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(receivesNothing(bob)).isTrue();
    }

    @Test
    @DisplayName("a subscriber that disconnected breaks neither the POST nor delivery to others")
    void closedSubscriberDoesNotBreakDelivery() throws Exception {
        Tab gone = connect(BOB);
        Tab alive = connect(BOB);
        subscribe(gone, ROOM);
        subscribe(alive, ROOM);
        awaitSubscribers(ROOM, 2);
        gone.session().close();

        ResponseEntity<String> response = post(ALICE, ROOM, "still here");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(nextFrame(alive).path("data").path("content").asText()).isEqualTo("still here");
    }
}
