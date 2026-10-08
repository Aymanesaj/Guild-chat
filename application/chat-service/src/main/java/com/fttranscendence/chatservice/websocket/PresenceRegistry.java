package com.fttranscendence.chatservice.websocket;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;

import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

/**
 * Presence follows open /ws/chat sockets, regardless of room subscriptions.
 * The last disconnect gets a grace period so refreshes do not flicker offline.
 * In memory: multiple chat-service instances would need a shared store.
 *
 * State changes, snapshots and notifications share a lock so a stale snapshot
 * or delayed offline task cannot overtake a reconnect's online notification.
 */
@Component
public class PresenceRegistry {

    public static final String ONLINE = "online";
    public static final String OFFLINE = "offline";
    static final Duration GRACE = Duration.ofSeconds(5);

    private final Map<String, Set<String>> socketsByUser = new HashMap<>();
    private final Map<String, Instant> lastSeen = new HashMap<>();
    private final Map<String, ScheduledFuture<?>> pendingOffline = new HashMap<>();
    private final Map<String, Map<String, WebSocketSession>> watchersByUser = new HashMap<>();
    private final Map<String, Set<String>> watchedBySession = new HashMap<>();

    private final Clock clock;
    private final TaskScheduler scheduler;
    private final FrameSender frameSender;

    public PresenceRegistry(Clock clock, TaskScheduler scheduler, FrameSender frameSender) {
        this.clock = clock;
        this.scheduler = scheduler;
        this.frameSender = frameSender;
    }

    /** Idempotent: opening an extra tab does not publish another online event. */
    public synchronized void connected(String userId, String sessionId) {
        boolean wasOnline = isOnline(userId);
        socketsByUser.computeIfAbsent(userId, id -> new HashSet<>()).add(sessionId);
        ScheduledFuture<?> pending = pendingOffline.remove(userId);
        if (pending != null) {
            pending.cancel(false);
        }
        lastSeen.remove(userId);
        if (!wasOnline) {
            broadcast(userId, ONLINE);
        }
    }

    /** Idempotent: transport error and close may both report the same socket. */
    public synchronized void disconnected(String userId, String sessionId) {
        Set<String> sockets = socketsByUser.get(userId);
        if (sockets == null || !sockets.remove(sessionId) || !sockets.isEmpty()) {
            return;
        }
        socketsByUser.remove(userId);
        Instant seen = clock.instant();
        lastSeen.put(userId, seen);
        pendingOffline.put(userId, scheduler.schedule(() -> expire(userId, seen), seen.plus(GRACE)));
    }

    private synchronized void expire(String userId, Instant seen) {
        // A cancelled task might already be running: only expire this disconnect.
        if (socketsByUser.containsKey(userId) || !seen.equals(lastSeen.get(userId))) {
            return;
        }
        lastSeen.remove(userId);
        pendingOffline.remove(userId);
        broadcast(userId, OFFLINE);
    }

    public synchronized boolean isOnline(String userId) {
        if (socketsByUser.containsKey(userId)) {
            return true;
        }
        Instant seen = lastSeen.get(userId);
        // The scheduled task cleans up and notifies watchers, even if REST reads first.
        return seen != null && clock.instant().isBefore(seen.plus(GRACE));
    }

    public synchronized Map<String, String> statuses(Collection<String> userIds) {
        Map<String, String> statuses = new LinkedHashMap<>();
        userIds.forEach(id -> statuses.put(id, isOnline(id) ? ONLINE : OFFLINE));
        return statuses;
    }

    /** Register before sending the snapshot so no transition is lost between them. */
    public synchronized void subscribe(WebSocketSession session, Collection<String> userIds) {
        if (!session.isOpen()) {
            return;
        }
        Set<String> watched = watchedBySession.computeIfAbsent(session.getId(), id -> new HashSet<>());
        for (String userId : userIds) {
            watched.add(userId);
            watchersByUser.computeIfAbsent(userId, id -> new HashMap<>()).put(session.getId(), session);
        }
        frameSender.send(session, WsEvents.PRESENCE_SNAPSHOT, Map.of("statuses", statuses(userIds)));
    }

    public synchronized void unsubscribe(WebSocketSession session, Collection<String> userIds) {
        Set<String> watched = watchedBySession.get(session.getId());
        if (watched == null) {
            return;
        }
        for (String userId : userIds) {
            watched.remove(userId);
            Map<String, WebSocketSession> watchers = watchersByUser.get(userId);
            if (watchers != null) {
                watchers.remove(session.getId());
                if (watchers.isEmpty()) {
                    watchersByUser.remove(userId);
                }
            }
        }
        if (watched.isEmpty()) {
            watchedBySession.remove(session.getId());
        }
    }

    public synchronized void removeSession(WebSocketSession session) {
        Set<String> watched = watchedBySession.get(session.getId());
        if (watched != null) {
            unsubscribe(session, Set.copyOf(watched));
        }
    }

    private void broadcast(String userId, String status) {
        Map<String, String> data = Map.of("user_id", userId, "status", status);
        watchersByUser.getOrDefault(userId, Map.of()).values()
                .forEach(session -> frameSender.send(session, WsEvents.PRESENCE_CHANGED, data));
    }

    synchronized int openSocketCount(String userId) {
        Set<String> sockets = socketsByUser.get(userId);
        return sockets == null ? 0 : sockets.size();
    }
}
