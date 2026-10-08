package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * Opens REAL WebSocket connections against a running server on a random port.
 *
 * A handler unit test with a mock session proves routing; only a real client
 * proves the protocol: that a rejected handshake never becomes a socket, and
 * that the user id resolved during the handshake survives into the session.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketHandshakeTest extends MongoTestSupport {

    private static final String TOKEN = "header.payload.signature";
    private static final String USER_ID = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @LocalServerPort
    private int port;

    /** The real identity-service is not running in tests. */
    @MockBean
    private IdentityClient identityClient;

    @Autowired
    private ChatWebSocketHandler chatWebSocketHandler;

    private final StandardWebSocketClient client = new StandardWebSocketClient();

    private WebSocketSession connect(String query) throws Exception {
        String url = "ws://localhost:" + port + "/ws/chat" + query;
        return client.execute(new TextWebSocketHandler() {
        }, url).get(5, TimeUnit.SECONDS);
    }

    /** The registry is updated asynchronously, so poll instead of sleeping blindly. */
    private void awaitConnectionCount(String userId, int expected) throws Exception {
        for (int attempt = 0; attempt < 50; attempt++) {
            if (chatWebSocketHandler.connectionCount(userId) == expected) {
                return;
            }
            Thread.sleep(100);
        }
        assertThat(chatWebSocketHandler.connectionCount(userId))
                .as("connection count for %s", userId)
                .isEqualTo(expected);
    }

    @Test
    @DisplayName("valid token: the socket opens and carries the user id from the handshake")
    void validTokenConnects() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(USER_ID));

        WebSocketSession session = connect("?token=" + TOKEN);

        assertThat(session.isOpen()).isTrue();
        awaitConnectionCount(USER_ID, 1);

        session.close();
        awaitConnectionCount(USER_ID, 0);
    }

    @Test
    @DisplayName("no token: the handshake fails, so no socket ever exists")
    void missingTokenIsRejected() {
        assertThatThrownBy(() -> connect(""))
                .isInstanceOf(ExecutionException.class);

        assertThat(chatWebSocketHandler.connectionCount(USER_ID)).isZero();
    }

    @Test
    @DisplayName("invalid token: the handshake fails")
    void invalidTokenIsRejected() {
        when(identityClient.validateToken("tampered")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> connect("?token=tampered"))
                .isInstanceOf(ExecutionException.class);
    }

    @Test
    @DisplayName("blank token: rejected without asking identity")
    void blankTokenIsRejected() {
        assertThatThrownBy(() -> connect("?token="))
                .isInstanceOf(ExecutionException.class);

        org.mockito.Mockito.verify(identityClient, org.mockito.Mockito.never()).validateToken(any());
    }

    @Test
    @DisplayName("identity unreachable: the handshake is refused rather than admitted unauthenticated")
    void identityOutageIsRejected() {
        when(identityClient.validateToken(TOKEN)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE", "identity-service is unavailable"));

        assertThatThrownBy(() -> connect("?token=" + TOKEN))
                .isInstanceOf(ExecutionException.class);

        assertThat(chatWebSocketHandler.connectionCount(USER_ID)).isZero();
    }

    @Test
    @DisplayName("one user, two tabs: both connections are tracked, and closing one keeps the other")
    void multipleConnectionsPerUser() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(USER_ID));

        WebSocketSession laptop = connect("?token=" + TOKEN);
        WebSocketSession phone = connect("?token=" + TOKEN);

        awaitConnectionCount(USER_ID, 2);

        laptop.close();
        awaitConnectionCount(USER_ID, 1);
        assertThat(phone.isOpen()).isTrue();

        phone.close();
        awaitConnectionCount(USER_ID, 0);
    }

    @Test
    @DisplayName("two different users are tracked separately")
    void connectionsAreScopedPerUser() throws Exception {
        String otherUser = "b111c5f8-d810-4518-ad4c-8d551eb6dfc4";
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(USER_ID));
        when(identityClient.validateToken("other-token")).thenReturn(Optional.of(otherUser));

        WebSocketSession first = connect("?token=" + TOKEN);
        WebSocketSession second = connect("?token=other-token");

        awaitConnectionCount(USER_ID, 1);
        awaitConnectionCount(otherUser, 1);

        first.close();
        second.close();
        awaitConnectionCount(USER_ID, 0);
        awaitConnectionCount(otherUser, 0);
    }

    @Test
    @DisplayName("the REST filter does not intercept the handshake: no Authorization header is needed")
    void handshakeIsNotBlockedByTheRestFilter() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(USER_ID));

        // No Authorization header anywhere — only ?token=, which is all a
        // browser can send. If AuthenticationFilter filtered /ws/**, this would
        // fail with a 401 before the upgrade.
        WebSocketSession session = connect("?token=" + TOKEN);

        assertThat(session.isOpen()).isTrue();
        session.close();
        awaitConnectionCount(USER_ID, 0);
    }
}
