package com.fttranscendence.chatservice.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.WebSocketSession;

/** Pure logic, no Spring: counting sockets and the offline grace period. */
class PresenceRegistryTest {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";

    /** A clock the test moves by hand, so the grace period needs no sleeping. */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-09-24T10:00:00Z");

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    private MutableClock clock;
    private PresenceRegistry presence;
    private TaskScheduler scheduler;
    private FrameSender sender;
    private final List<Runnable> delayed = new ArrayList<>();
    private ScheduledFuture<?> pending;

    @BeforeEach
    void setUp() {
        clock = new MutableClock();
        scheduler = mock(TaskScheduler.class);
        sender = mock(FrameSender.class);
        pending = mock(ScheduledFuture.class);
        when(scheduler.schedule(any(Runnable.class), any(Instant.class))).thenAnswer(invocation -> {
            delayed.add(invocation.getArgument(0));
            return pending;
        });
        presence = new PresenceRegistry(clock, scheduler, sender);
    }

    @Test
    @DisplayName("a user who never connected is offline")
    void unknownUserIsOffline() {
        assertThat(presence.isOnline(ALICE)).isFalse();
    }

    @Test
    @DisplayName("one open socket makes the user online")
    void openSocketIsOnline() {
        presence.connected(ALICE, "s1");

        assertThat(presence.isOnline(ALICE)).isTrue();
        assertThat(presence.isOnline(BOB)).isFalse();
    }

    @Test
    @DisplayName("closing one of two tabs keeps the user online, with no grace needed")
    void secondTabKeepsUserOnline() {
        presence.connected(ALICE, "tab1");
        presence.connected(ALICE, "tab2");

        presence.disconnected(ALICE, "tab1");
        clock.advance(Duration.ofMinutes(10));

        assertThat(presence.isOnline(ALICE)).isTrue();
        assertThat(presence.openSocketCount(ALICE)).isEqualTo(1);
    }

    @Test
    @DisplayName("after the last socket closes the user stays online for the grace period (page refresh)")
    void onlineDuringGrace() {
        presence.connected(ALICE, "s1");
        presence.disconnected(ALICE, "s1");

        clock.advance(PresenceRegistry.GRACE.minusMillis(1));

        assertThat(presence.isOnline(ALICE)).isTrue();
    }

    @Test
    @DisplayName("at exactly the end of the grace period the user is offline")
    void offlineWhenGraceEnds() {
        presence.connected(ALICE, "s1");
        presence.disconnected(ALICE, "s1");

        clock.advance(PresenceRegistry.GRACE);

        assertThat(presence.isOnline(ALICE)).isFalse();
    }

    @Test
    @DisplayName("a refresh (close then reopen within the grace) never reads as offline")
    void refreshWithinGraceStaysOnline() {
        presence.connected(ALICE, "old");
        presence.disconnected(ALICE, "old");
        clock.advance(Duration.ofSeconds(1));
        presence.connected(ALICE, "new");

        clock.advance(Duration.ofMinutes(10));

        assertThat(presence.isOnline(ALICE))
                .as("the reconnect cleared the pending offline")
                .isTrue();
    }

    @Test
    @DisplayName("the same socket reported closed twice (transport error, then close) is harmless")
    void doubleDisconnectIsIdempotent() {
        presence.connected(ALICE, "s1");
        presence.connected(ALICE, "s2");

        presence.disconnected(ALICE, "s1");
        presence.disconnected(ALICE, "s1");

        assertThat(presence.openSocketCount(ALICE)).isEqualTo(1);
        assertThat(presence.isOnline(ALICE)).isTrue();
    }

    @Test
    @DisplayName("the same socket reported open twice counts once")
    void doubleConnectIsIdempotent() {
        presence.connected(ALICE, "s1");
        presence.connected(ALICE, "s1");
        presence.disconnected(ALICE, "s1");
        clock.advance(PresenceRegistry.GRACE);

        assertThat(presence.isOnline(ALICE)).isFalse();
    }

    @Test
    @DisplayName("disconnecting a socket that was never registered changes nothing")
    void unknownDisconnectIsIgnored() {
        presence.disconnected(ALICE, "ghost");

        assertThat(presence.isOnline(ALICE)).isFalse();
    }

    @Test
    @DisplayName("statuses answers every id, in the order asked")
    void statusesKeepsOrder() {
        presence.connected(BOB, "s1");

        assertThat(presence.statuses(List.of(ALICE, BOB)))
                .containsExactly(
                        org.assertj.core.api.Assertions.entry(ALICE, PresenceRegistry.OFFLINE),
                        org.assertj.core.api.Assertions.entry(BOB, PresenceRegistry.ONLINE));
    }

    private WebSocketSession watcher(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        return session;
    }

    @Test
    void subscriptionReturnsSnapshotThenOnlyOneOnlineEventForMultipleTabs() {
        WebSocketSession viewer = watcher("viewer");
        presence.subscribe(viewer, List.of(ALICE, BOB));
        verify(sender).send(viewer, WsEvents.PRESENCE_SNAPSHOT,
                Map.of("statuses", Map.of(ALICE, "offline", BOB, "offline")));
        clearInvocations(sender);

        presence.connected(ALICE, "tab1");
        presence.connected(ALICE, "tab2");
        presence.connected(ALICE, "tab2");
        presence.disconnected(ALICE, "tab1");

        verify(sender, times(1)).send(viewer, WsEvents.PRESENCE_CHANGED,
                Map.of("user_id", ALICE, "status", "online"));
        verifyNoMoreInteractions(sender);
        verifyNoInteractions(scheduler);
    }

    @Test
    void offlineIsPushedAfterGraceEvenIfRestAlreadyReadOffline() {
        WebSocketSession viewer = watcher("viewer");
        presence.connected(ALICE, "tab1");
        presence.subscribe(viewer, List.of(ALICE));
        clearInvocations(sender);

        presence.disconnected(ALICE, "tab1");
        presence.disconnected(ALICE, "tab1");
        verifyNoInteractions(sender);
        assertThat(delayed).hasSize(1);
        clock.advance(PresenceRegistry.GRACE);
        assertThat(presence.isOnline(ALICE)).isFalse();
        delayed.getFirst().run();

        verify(sender).send(viewer, WsEvents.PRESENCE_CHANGED,
                Map.of("user_id", ALICE, "status", "offline"));
        delayed.getFirst().run();
        verifyNoMoreInteractions(sender);
    }

    @Test
    void reconnectCancelsOfflineEvenWhenCancelledCallbackStillRuns() {
        WebSocketSession viewer = watcher("viewer");
        presence.connected(ALICE, "old");
        presence.subscribe(viewer, List.of(ALICE));
        clearInvocations(sender);

        presence.disconnected(ALICE, "old");
        clock.advance(Duration.ofSeconds(1));
        presence.connected(ALICE, "new");
        verify(pending).cancel(false);
        clock.advance(PresenceRegistry.GRACE);
        delayed.getFirst().run();

        assertThat(presence.isOnline(ALICE)).isTrue();
        verifyNoInteractions(sender);
    }

    @Test
    void staleCallbackDoesNotExpireALaterDisconnect() {
        presence.connected(ALICE, "old");
        presence.disconnected(ALICE, "old");
        clock.advance(Duration.ofSeconds(1));
        presence.connected(ALICE, "new");
        presence.disconnected(ALICE, "new");
        clock.advance(Duration.ofSeconds(4));
        delayed.getFirst().run();
        assertThat(presence.isOnline(ALICE)).isTrue();
        clock.advance(Duration.ofSeconds(1));
        delayed.get(1).run();
        assertThat(presence.isOnline(ALICE)).isFalse();
    }

    @Test
    void unsubscribeAndCloseRemoveOnlyThatSocketsWatchers() {
        WebSocketSession first = watcher("first");
        WebSocketSession second = watcher("second");
        presence.subscribe(first, List.of(ALICE, BOB));
        presence.subscribe(first, List.of(ALICE)); // duplicate subscription
        presence.subscribe(second, List.of(ALICE));
        presence.unsubscribe(first, List.of(ALICE));
        presence.removeSession(first);
        presence.removeSession(first); // duplicate cleanup
        clearInvocations(sender);

        presence.connected(ALICE, "alice");
        presence.connected(BOB, "bob");
        verify(sender).send(second, WsEvents.PRESENCE_CHANGED,
                Map.of("user_id", ALICE, "status", "online"));
        verifyNoMoreInteractions(sender);
    }

    @Test
    void closedSocketCannotAddWatchers() {
        WebSocketSession viewer = watcher("closed");
        when(viewer.isOpen()).thenReturn(false);
        presence.subscribe(viewer, List.of(ALICE));
        presence.connected(ALICE, "alice");
        verifyNoInteractions(sender);
    }

    @Test
    @DisplayName("many sockets opening and closing concurrently leave an exact count")
    void concurrentConnectsAndDisconnectsAreConsistent() throws Exception {
        int sockets = 200;
        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(sockets);

        for (int i = 0; i < sockets; i++) {
            String sessionId = "s" + i;
            boolean closes = i % 2 == 0;
            pool.submit(() -> {
                try {
                    start.await();
                    presence.connected(ALICE, sessionId);
                    if (closes) {
                        presence.disconnected(ALICE, sessionId);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }
        start.countDown();
        assertThat(done.await(10, TimeUnit.SECONDS)).isTrue();
        pool.shutdown();

        assertThat(presence.openSocketCount(ALICE)).isEqualTo(sockets / 2);
        assertThat(presence.isOnline(ALICE)).isTrue();
    }
}
