package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * subscribe / unsubscribe over real sockets.
 *
 * The membership check here is the socket's entire security story: without it
 * any authenticated user could stream any room, including other people's DMs.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketSubscriptionTest extends MongoTestSupport {

    private static final String TOKEN = "alice.token";
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final long ROOM = 42L;
    private static final long FORBIDDEN_ROOM = 99L;

    @LocalServerPort
    private int port;

    @MockBean
    private IdentityClient identityClient;

    @MockBean
    private OrgClient orgClient;

    @Autowired
    private SubscriptionRegistry subscriptions;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final StandardWebSocketClient client = new StandardWebSocketClient();

    private static final class RecordingClient extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.add(message.getPayload());
        }
    }

    private RecordingClient recorder;
    private WebSocketSession session;

    private WebSocketSession connect() throws Exception {
        when(identityClient.validateToken(TOKEN)).thenReturn(Optional.of(ALICE));
        recorder = new RecordingClient();
        session = client.execute(recorder, "ws://localhost:" + port + "/ws/chat?token=" + TOKEN)
                .get(5, TimeUnit.SECONDS);
        return session;
    }

    @AfterEach
    void cleanUp() throws Exception {
        if (session != null && session.isOpen()) {
            session.close();
        }
        awaitSubscribers(ROOM, 0);
        awaitSubscribers(FORBIDDEN_ROOM, 0);
    }

    private void send(String json) throws Exception {
        session.sendMessage(new TextMessage(json));
    }

    private String subscribeFrame(long roomId) {
        return "{\"event\":\"subscribe\",\"data\":{\"room_id\":" + roomId + "}}";
    }

    private String unsubscribeFrame(long roomId) {
        return "{\"event\":\"unsubscribe\",\"data\":{\"room_id\":" + roomId + "}}";
    }

    /** Frames are handled asynchronously, so poll rather than sleep blindly. */
    private void awaitSubscribers(long roomId, int expected) throws Exception {
        for (int attempt = 0; attempt < 50; attempt++) {
            if (subscriptions.subscriberCount(roomId) == expected) {
                return;
            }
            Thread.sleep(100);
        }
        assertThat(subscriptions.subscriberCount(roomId))
                .as("subscribers in room %s", roomId)
                .isEqualTo(expected);
    }

    private JsonNode nextFrame() throws Exception {
        String frame = recorder.frames.poll(3, TimeUnit.SECONDS);
        assertThat(frame).as("expected a frame").isNotNull();
        return objectMapper.readTree(frame);
    }

    private boolean noFrameArrives() throws Exception {
        return recorder.frames.poll(500, TimeUnit.MILLISECONDS) == null;
    }

    @Test
    @DisplayName("a member subscribing is registered as a fan-out target, with no error frame")
    void memberCanSubscribe() throws Exception {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        connect();

        send(subscribeFrame(ROOM));

        awaitSubscribers(ROOM, 1);
        assertThat(noFrameArrives()).as("success is silent").isTrue();
    }

    @Test
    @DisplayName("a non-member gets NOT_A_MEMBER and is NOT registered")
    void nonMemberCannotSubscribe() throws Exception {
        when(orgClient.isMember(ALICE, FORBIDDEN_ROOM)).thenReturn(false);
        connect();

        send(subscribeFrame(FORBIDDEN_ROOM));

        JsonNode error = nextFrame();
        assertThat(error.path("event").asText()).isEqualTo("error");
        assertThat(error.path("data").path("code").asText()).isEqualTo("NOT_A_MEMBER");

        assertThat(subscriptions.subscriberCount(FORBIDDEN_ROOM))
                .as("a rejected subscribe must leave no trace in the registry")
                .isZero();
        assertThat(session.isOpen()).as("rejection must not close the socket").isTrue();
    }

    @Test
    @DisplayName("org unavailable: the subscribe is refused rather than guessed either way")
    void orgOutageRefusesSubscribe() throws Exception {
        when(orgClient.isMember(ALICE, ROOM)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable"));
        connect();

        send(subscribeFrame(ROOM));

        assertThat(nextFrame().path("data").path("code").asText()).isEqualTo("ORG_UNAVAILABLE");
        assertThat(subscriptions.subscriberCount(ROOM)).isZero();
    }

    @Test
    @DisplayName("a non-numeric room_id gets INVALID_ROOM_ID and org is never asked")
    void invalidRoomIdIsRejected() throws Exception {
        connect();

        send("{\"event\":\"subscribe\",\"data\":{\"room_id\":\"forty-two\"}}");

        assertThat(nextFrame().path("data").path("code").asText()).isEqualTo("INVALID_ROOM_ID");
        org.mockito.Mockito.verify(orgClient, org.mockito.Mockito.never())
                .isMember(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    @DisplayName("a fractional room_id gets INVALID_ROOM_ID instead of being truncated to 42")
    void fractionalRoomIdIsRejected() throws Exception {
        connect();

        send("{\"event\":\"subscribe\",\"data\":{\"room_id\":42.7}}");

        assertThat(nextFrame().path("data").path("code").asText()).isEqualTo("INVALID_ROOM_ID");
        assertThat(subscriptions.subscriberCount(ROOM)).isZero();
    }

    @Test
    @DisplayName("a numeric string room_id gets INVALID_ROOM_ID: the contract says number")
    void stringRoomIdIsRejected() throws Exception {
        connect();

        send("{\"event\":\"subscribe\",\"data\":{\"room_id\":\"42\"}}");

        assertThat(nextFrame().path("data").path("code").asText()).isEqualTo("INVALID_ROOM_ID");
    }

    @Test
    @DisplayName("a missing room_id gets MISSING_ROOM_ID")
    void missingRoomIdIsRejected() throws Exception {
        connect();

        send("{\"event\":\"subscribe\",\"data\":{}}");

        assertThat(nextFrame().path("data").path("code").asText()).isEqualTo("MISSING_ROOM_ID");
    }

    @Test
    @DisplayName("subscribing twice is idempotent: one socket counts once")
    void doubleSubscribeIsIdempotent() throws Exception {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        connect();

        send(subscribeFrame(ROOM));
        awaitSubscribers(ROOM, 1);
        send(subscribeFrame(ROOM));

        Thread.sleep(300);
        assertThat(subscriptions.subscriberCount(ROOM)).isEqualTo(1);
    }

    @Test
    @DisplayName("unsubscribe removes the socket and needs no membership check")
    void unsubscribeWorksWithoutMembership() throws Exception {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        connect();

        send(subscribeFrame(ROOM));
        awaitSubscribers(ROOM, 1);

        // Simulates being kicked between subscribing and leaving: leaving must
        // still work, or the subscription would be stuck in the registry.
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(false);
        send(unsubscribeFrame(ROOM));

        awaitSubscribers(ROOM, 0);
        assertThat(noFrameArrives()).as("unsubscribe reports no error").isTrue();
    }

    @Test
    @DisplayName("unsubscribing from a room you never joined is harmless")
    void unsubscribeUnknownRoomIsIgnored() throws Exception {
        connect();

        send(unsubscribeFrame(ROOM));

        assertThat(noFrameArrives()).isTrue();
        assertThat(subscriptions.subscriberCount(ROOM)).isZero();
        assertThat(session.isOpen()).isTrue();
    }

    @Test
    @DisplayName("closing the socket removes it from every room it had joined")
    void closingCleansUpSubscriptions() throws Exception {
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        when(orgClient.isMember(ALICE, FORBIDDEN_ROOM)).thenReturn(true);
        connect();

        send(subscribeFrame(ROOM));
        send(subscribeFrame(FORBIDDEN_ROOM));
        awaitSubscribers(ROOM, 1);
        awaitSubscribers(FORBIDDEN_ROOM, 1);

        session.close();

        awaitSubscribers(ROOM, 0);
        awaitSubscribers(FORBIDDEN_ROOM, 0);
        assertThat(subscriptions.roomCount()).as("no empty room entries left behind").isZero();
        assertThat(subscriptions.trackedSessionCount()).isZero();
    }
}
