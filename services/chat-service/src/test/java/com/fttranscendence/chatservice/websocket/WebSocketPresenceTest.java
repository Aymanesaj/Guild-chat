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

    private WebSocketSession connect(String userId) throws Exception {
        WebSocketSession session = client
                .execute(new TextWebSocketHandler(), "ws://localhost:" + port + "/ws/chat?token=" + userId + ".token")
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

    @Test
    @DisplayName("GET /presence without a token is a 401 from the filter")
    void requiresAuthentication() {
        ResponseEntity<String> response = rest.getForEntity("/presence?ids=" + alice, String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
