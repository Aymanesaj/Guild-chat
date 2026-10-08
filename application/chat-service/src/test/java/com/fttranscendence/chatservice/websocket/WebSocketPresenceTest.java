package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

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
import org.springframework.http.ResponseEntity;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * The whole path: a real socket opens (no room subscribed) and GET /presence
 * reports the user online; a user with no socket is offline.
 *
 * Each test uses fresh user ids: the registry lives in the Spring context,
 * which other test classes share.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketPresenceTest extends MongoTestSupport {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private PresenceRegistry presenceRegistry;

    @MockBean
    private IdentityClient identityClient;

    @MockBean
    private OrgClient orgClient;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final StandardWebSocketClient client = new StandardWebSocketClient();
    private final List<WebSocketSession> opened = new ArrayList<>();

    private String viewer;
    private String alice;
    private String bob;

    @BeforeEach
    void setUp() {
        viewer = UUID.randomUUID().toString();
        alice = UUID.randomUUID().toString();
        bob = UUID.randomUUID().toString();
        when(identityClient.validateToken(anyString())).thenReturn(Optional.empty());
        for (String user : List.of(viewer, alice, bob)) {
            when(identityClient.validateToken(user + ".token")).thenReturn(Optional.of(user));
        }
        when(orgClient.isMember(anyString(), anyLong())).thenReturn(true);
    }

    @AfterEach
    void cleanUp() throws Exception {
        for (WebSocketSession session : opened) {
            if (session.isOpen()) {
                session.close();
            }
        }
    }

    private static final class RecordingClient extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.add(message.getPayload());
        }
    }

    private WebSocketSession connect(String userId) throws Exception {
        return connect(userId, new TextWebSocketHandler());
    }

    private WebSocketSession connect(String userId, TextWebSocketHandler handler) throws Exception {
        WebSocketSession session = client
                .execute(handler, "ws://localhost:" + port + "/ws/chat?token=" + userId + ".token")
                .get(5, TimeUnit.SECONDS);
        opened.add(session);
        return session;
    }

    private JsonNode presence(String... ids) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(viewer + ".token");
        ResponseEntity<String> response = rest.exchange("/presence?ids=" + String.join(",", ids),
                HttpMethod.GET, new HttpEntity<>(headers), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody());
    }

    /** The server registers the socket right after the handshake; poll briefly instead of sleeping. */
    private void awaitOpenSockets(String userId, int expected) throws Exception {
        for (int i = 0; i < 50 && presenceRegistry.openSocketCount(userId) != expected; i++) {
            Thread.sleep(100);
        }
        assertThat(presenceRegistry.openSocketCount(userId)).isEqualTo(expected);
    }

    @Test
    @DisplayName("a connected user is online without subscribing to any room; others are offline")
    void connectedWithoutRoomsIsOnline() throws Exception {
        connect(alice);
        awaitOpenSockets(alice, 1);

        JsonNode statuses = presence(alice, bob);

        assertThat(statuses.path(alice).asText()).isEqualTo("online");
        assertThat(statuses.path(bob).asText()).isEqualTo("offline");
    }

    @Test
    @DisplayName("closing one of two tabs keeps the user online")
    void secondTabKeepsUserOnline() throws Exception {
        WebSocketSession tab1 = connect(alice);
        connect(alice);
        awaitOpenSockets(alice, 2);

        tab1.close();
        awaitOpenSockets(alice, 1);

        assertThat(presence(alice).path(alice).asText()).isEqualTo("online");
    }

    @Test
    @DisplayName("right after the last socket closes the user is still online (grace for a page refresh)")
    void lastSocketClosedIsOnlineDuringGrace() throws Exception {
        WebSocketSession only = connect(alice);
        awaitOpenSockets(alice, 1);

        only.close();
        awaitOpenSockets(alice, 0);

        assertThat(presence(alice).path(alice).asText()).isEqualTo("online");
    }

    private JsonNode nextFrame(RecordingClient recorder) throws Exception {
        String frame = recorder.frames.poll(8, TimeUnit.SECONDS);
        assertThat(frame).as("expected a WebSocket frame").isNotNull();
        return objectMapper.readTree(frame);
    }

    private void watch(WebSocketSession session, String event, List<String> ids) throws Exception {
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(
                java.util.Map.of("event", event, "data", java.util.Map.of("user_ids", ids)))));
    }

    @Test
    void snapshotAndTransitionsArriveWithoutRoomSubscriptionsOrRestPolling() throws Exception {
        RecordingClient recorder = new RecordingClient();
        WebSocketSession viewerSocket = connect(viewer, recorder);
        watch(viewerSocket, "presence.subscribe", List.of(alice));
        JsonNode snapshot = nextFrame(recorder);
        assertThat(snapshot.path("event").asText()).isEqualTo("presence.snapshot");
        assertThat(snapshot.path("data").path("statuses").path(alice).asText()).isEqualTo("offline");

        WebSocketSession aliceSocket = connect(alice);
        JsonNode online = nextFrame(recorder);
        assertThat(online.path("event").asText()).isEqualTo("presence.changed");
        assertThat(online.path("data").path("user_id").asText()).isEqualTo(alice);
        assertThat(online.path("data").path("status").asText()).isEqualTo("online");

        aliceSocket.close();
        awaitOpenSockets(alice, 0);
        assertThat(recorder.frames.poll(200, TimeUnit.MILLISECONDS)).isNull();
        JsonNode offline = nextFrame(recorder);
        assertThat(offline.path("data").path("status").asText()).isEqualTo("offline");
        assertThat(presence(alice).path(alice).asText()).isEqualTo("offline");
    }

    @Test
    void unsubscribingStopsChangesAndResubscribingReturnsFreshSnapshot() throws Exception {
        RecordingClient recorder = new RecordingClient();
        WebSocketSession viewerSocket = connect(viewer, recorder);
        watch(viewerSocket, "presence.subscribe", List.of(alice));
        nextFrame(recorder);
        watch(viewerSocket, "presence.unsubscribe", List.of(alice));
        // This snapshot is an ordering barrier: the unsubscribe was processed.
        watch(viewerSocket, "presence.subscribe", List.of(bob));
        nextFrame(recorder);
        connect(alice);
        awaitOpenSockets(alice, 1);
        assertThat(recorder.frames.poll(300, TimeUnit.MILLISECONDS)).isNull();

        watch(viewerSocket, "presence.subscribe", List.of(alice));
        assertThat(nextFrame(recorder).path("data").path("statuses").path(alice).asText()).isEqualTo("online");
    }

    @Test
    void invalidPresenceSubscriptionsReturnErrors() throws Exception {
        RecordingClient recorder = new RecordingClient();
        WebSocketSession viewerSocket = connect(viewer, recorder);
        watch(viewerSocket, "presence.subscribe", List.of());
        assertThat(nextFrame(recorder).path("data").path("code").asText()).isEqualTo("INVALID_USER_IDS");
        watch(viewerSocket, "presence.subscribe", List.of(" "));
        assertThat(nextFrame(recorder).path("data").path("code").asText()).isEqualTo("INVALID_USER_IDS");
        watch(viewerSocket, "presence.subscribe", java.util.stream.IntStream.range(0, 101)
                .mapToObj(i -> "user-" + i).toList());
        assertThat(nextFrame(recorder).path("data").path("code").asText()).isEqualTo("TOO_MANY_IDS");
    }

    @Test
    @DisplayName("GET /presence without a token is a 401 from the filter")
    void requiresAuthentication() {
        ResponseEntity<String> response = rest.getForEntity("/presence?ids=" + alice, String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
