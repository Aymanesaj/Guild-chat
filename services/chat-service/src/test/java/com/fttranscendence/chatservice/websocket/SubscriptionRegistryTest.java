package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

/**
 * The registry on its own: no Spring context, no sockets, milliseconds to run.
 *
 * The integration test proves the handler wires it up; this one pins down the
 * bookkeeping — both maps agree, and nothing empty is ever left behind.
 */
class SubscriptionRegistryTest {

    private static final long ROOM = 1L;
    private static final long OTHER_ROOM = 2L;

    private SubscriptionRegistry registry;
    private WebSocketSession tab1;
    private WebSocketSession tab2;

    @BeforeEach
    void setUp() {
        registry = new SubscriptionRegistry();
        tab1 = session("s1");
        tab2 = session("s2");
    }

    private static WebSocketSession session(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        return session;
    }

    @Test
    @DisplayName("an unknown room has no subscribers: empty, never null")
    void unknownRoomIsEmpty() {
        assertThat(registry.sessionsIn(ROOM)).isNotNull().isEmpty();
    }

    @Test
    @DisplayName("subscribe makes the session a fan-out target of that room only")
    void subscribeAddsToRoom() {
        registry.subscribe(ROOM, tab1);

        assertThat(registry.sessionsIn(ROOM)).containsExactly(tab1);
        assertThat(registry.sessionsIn(OTHER_ROOM)).isEmpty();
    }

    @Test
    @DisplayName("subscribing twice counts once")
    void subscribeIsIdempotent() {
        registry.subscribe(ROOM, tab1);
        registry.subscribe(ROOM, tab1);

        assertThat(registry.subscriberCount(ROOM)).isEqualTo(1);
        assertThat(registry.trackedSessionCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("several sessions in one room are all fan-out targets")
    void manySessionsPerRoom() {
        registry.subscribe(ROOM, tab1);
        registry.subscribe(ROOM, tab2);

        assertThat(registry.sessionsIn(ROOM)).containsExactlyInAnyOrder(tab1, tab2);
    }

    @Test
    @DisplayName("unsubscribe removes only that session, and only from that room")
    void unsubscribeIsTargeted() {
        registry.subscribe(ROOM, tab1);
        registry.subscribe(ROOM, tab2);
        registry.subscribe(OTHER_ROOM, tab1);

        registry.unsubscribe(ROOM, tab1);

        assertThat(registry.sessionsIn(ROOM)).containsExactly(tab2);
        assertThat(registry.sessionsIn(OTHER_ROOM)).containsExactly(tab1);
    }

    @Test
    @DisplayName("the last unsubscribe drops the room and session entries entirely")
    void unsubscribeLeavesNoEmptySets() {
        registry.subscribe(ROOM, tab1);

        registry.unsubscribe(ROOM, tab1);

        assertThat(registry.roomCount()).isZero();
        assertThat(registry.trackedSessionCount()).isZero();
    }

    @Test
    @DisplayName("unsubscribing from a room never joined changes nothing")
    void unsubscribeUnknownIsHarmless() {
        registry.subscribe(ROOM, tab1);

        registry.unsubscribe(OTHER_ROOM, tab1);
        registry.unsubscribe(ROOM, tab2);

        assertThat(registry.sessionsIn(ROOM)).containsExactly(tab1);
        assertThat(registry.roomCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("removeSession drops the session from every room it joined")
    void removeSessionCleansEveryRoom() {
        registry.subscribe(ROOM, tab1);
        registry.subscribe(OTHER_ROOM, tab1);
        registry.subscribe(ROOM, tab2);

        registry.removeSession(tab1);

        assertThat(registry.sessionsIn(ROOM)).containsExactly(tab2);
        assertThat(registry.sessionsIn(OTHER_ROOM)).isEmpty();
        assertThat(registry.roomCount()).as("OTHER_ROOM emptied, so gone").isEqualTo(1);
        assertThat(registry.trackedSessionCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("removeSession is idempotent and safe for a session that never subscribed")
    void removeSessionIsIdempotent() {
        registry.subscribe(ROOM, tab1);

        registry.removeSession(tab1);
        registry.removeSession(tab1);
        registry.removeSession(tab2);

        assertThat(registry.roomCount()).isZero();
        assertThat(registry.trackedSessionCount()).isZero();
    }

    @Test
    @DisplayName("removal matches by session id, so the raw session cleans up its decorator")
    void removalMatchesById() {
        // The handler registers the ConcurrentWebSocketSessionDecorator but
        // afterConnectionClosed receives the raw session: same id, different object.
        WebSocketSession decorator = session("s1");
        registry.subscribe(ROOM, decorator);

        registry.removeSession(tab1);

        assertThat(registry.sessionsIn(ROOM)).isEmpty();
        assertThat(registry.roomCount()).isZero();
    }
}
