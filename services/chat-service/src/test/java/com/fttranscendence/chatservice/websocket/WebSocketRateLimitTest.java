package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atMost;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.socket.CloseStatus;
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
 * The per-socket frame rate limit, over real sockets.
 *
 * Why it exists: every subscribe frame costs a gRPC call to org. A console
 * script flooding one socket with 10,000 subscribes pushed org-service past
 * 100% CPU. Past MAX_FRAMES_PER_SECOND in one second, the socket is closed
 * with 1008 (policy violation), so a flood costs at most that many org calls.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketRateLimitTest extends MongoTestSupport {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final int LIMIT = ChatWebSocketHandler.MAX_FRAMES_PER_SECOND;
    /** Rooms the other WebSocket test classes don't use: they share this context. */
    private static final long ROOM = 900L;

    @LocalServerPort
    private int port;

    @MockBean
    private IdentityClient identityClient;

    @MockBean
    private OrgClient orgClient;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final StandardWebSocketClient client = new StandardWebSocketClient();
    private final List<WebSocketSession> opened = new ArrayList<>();

    private static final class RecordingClient extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.add(message.getPayload());
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            closed.complete(status);
        }
    }

    private record Tab(WebSocketSession session, RecordingClient recorder) {
    }

    @BeforeEach
    void setUp() {
        when(identityClient.validateToken(ALICE + ".token")).thenReturn(Optional.of(ALICE));
        when(orgClient.isMember(anyString(), anyLong())).thenReturn(false);
    }

    @AfterEach
    void cleanUp() throws Exception {
        for (WebSocketSession session : opened) {
            if (session.isOpen()) {
                session.close();
            }
        }
    }

    private Tab connect() throws Exception {
        RecordingClient recorder = new RecordingClient();
        WebSocketSession session = client
                .execute(recorder, "ws://localhost:" + port + "/ws/chat?token=" + ALICE + ".token")
                .get(5, TimeUnit.SECONDS);
        opened.add(session);
        return new Tab(session, recorder);
    }

    /** unsubscribe is silent and never calls org: a pure "count this frame" frame. */
    private void sendQuietFrames(Tab tab, int count) throws Exception {
        for (int i = 0; i < count; i++) {
            tab.session().sendMessage(new TextMessage(
                    "{\"event\":\"unsubscribe\",\"data\":{\"room_id\":" + ROOM + "}}"));
        }
    }

    private boolean staysOpen(Tab tab) throws Exception {
        try {
            tab.recorder().closed.get(700, TimeUnit.MILLISECONDS);
            return false;
        } catch (java.util.concurrent.TimeoutException e) {
            return tab.session().isOpen();
        }
    }

    private CloseStatus awaitClose(Tab tab) throws Exception {
        return tab.recorder().closed.get(3, TimeUnit.SECONDS);
    }

    @Test
    @DisplayName("exactly the limit in one burst is fine: no error, socket stays open")
    void atTheLimitIsAllowed() throws Exception {
        Tab tab = connect();

        sendQuietFrames(tab, LIMIT);

        assertThat(staysOpen(tab)).isTrue();
        assertThat(tab.recorder().frames).isEmpty();
    }

    @Test
    @DisplayName("one frame over the limit: RATE_LIMIT_EXCEEDED, then closed with 1008")
    void overTheLimitClosesWith1008() throws Exception {
        Tab tab = connect();

        sendQuietFrames(tab, LIMIT + 1);

        CloseStatus status = awaitClose(tab);
        assertThat(status.getCode()).as("policy violation").isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
        String frame = tab.recorder().frames.poll(1, TimeUnit.SECONDS);
        assertThat(frame).as("the client is told why before the close").isNotNull();
        JsonNode error = objectMapper.readTree(frame);
        assertThat(error.path("event").asText()).isEqualTo("error");
        assertThat(error.path("data").path("code").asText()).isEqualTo("RATE_LIMIT_EXCEEDED");
    }

    @Test
    @DisplayName("the count starts over each second: two bursts of the limit, a second apart, are fine")
    void windowResets() throws Exception {
        Tab tab = connect();

        sendQuietFrames(tab, LIMIT);
        Thread.sleep(1_200);
        sendQuietFrames(tab, LIMIT);

        assertThat(staysOpen(tab)).isTrue();
    }

    @Test
    @DisplayName("a subscribe flood costs at most LIMIT org calls, not one per frame")
    void floodIsCutOffBeforeOrg() throws Exception {
        Tab tab = connect();

        for (int room = 1; room <= 1_000; room++) {
            if (!tab.session().isOpen()) {
                break;
            }
            try {
                tab.session().sendMessage(new TextMessage(
                        "{\"event\":\"subscribe\",\"data\":{\"room_id\":" + (100_000 + room) + "}}"));
            } catch (Exception closedMeanwhile) {
                break;
            }
        }

        assertThat(awaitClose(tab).getCode()).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
        verify(orgClient, atMost(LIMIT)).isMember(anyString(), anyLong());
    }

    @Test
    @DisplayName("the limit is per socket: one flooding tab does not close the user's other tab")
    void limitIsPerSocket() throws Exception {
        Tab flooding = connect();
        Tab quiet = connect();

        sendQuietFrames(flooding, LIMIT + 1);
        awaitClose(flooding);
        sendQuietFrames(quiet, LIMIT);

        assertThat(staysOpen(quiet)).isTrue();
    }
}
