package com.fttranscendence.chatservice.websocket;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Who is online: a user with at least one open /ws/chat socket.
 *
 * The frontend opens that socket at login and keeps it until logout, whatever
 * page is showing, so an open socket means "the app is open".
 *
 * Counted per socket, not per user: closing one of two tabs keeps the user
 * online. When the last socket closes the user stays online for GRACE, so a
 * page refresh (close, then reopen a moment later) never shows as offline.
 *
 * In memory, so it only knows this instance's sockets. A second chat instance
 * would need a shared store (Redis) — the same limit as the room broadcast.
 */
@Component
public class PresenceRegistry {

    public static final String ONLINE = "online";
    public static final String OFFLINE = "offline";

    static final Duration GRACE = Duration.ofSeconds(5);

    /** userId → ids of that user's open sockets. No entry = no open socket. */
    private final Map<String, Set<String>> socketsByUser = new ConcurrentHashMap<>();
    /** userId → when their last socket closed. Only read within GRACE. */
    private final Map<String, Instant> lastSeen = new ConcurrentHashMap<>();

    private final Clock clock;

    public PresenceRegistry(Clock clock) {
        this.clock = clock;
    }

    /** Idempotent: the same socket twice counts once. */
    public void connected(String userId, String sessionId) {
        // compute, not computeIfAbsent + add: a disconnect removing the empty
        // set in between would otherwise swallow this socket.
        socketsByUser.compute(userId, (id, sockets) -> {
            Set<String> open = sockets == null ? ConcurrentHashMap.newKeySet() : sockets;
            open.add(sessionId);
            return open;
        });
        lastSeen.remove(userId);
    }

    /** Idempotent: a socket can be reported closed twice (transport error, then close). */
    public void disconnected(String userId, String sessionId) {
        socketsByUser.computeIfPresent(userId, (id, sockets) -> {
            if (!sockets.remove(sessionId) || !sockets.isEmpty()) {
                return sockets;
            }
            lastSeen.put(userId, clock.instant());
            return null;
        });
    }

    public boolean isOnline(String userId) {
        if (socketsByUser.containsKey(userId)) {
            return true;
        }
        Instant seen = lastSeen.get(userId);
        if (seen == null) {
            return false;
        }
        if (clock.instant().isBefore(seen.plus(GRACE))) {
            return true;
        }
        lastSeen.remove(userId, seen); // expired: forget it, so the map doesn't grow forever
        return false;
    }

    /** In the order asked, one entry per distinct id. */
    public Map<String, String> statuses(Collection<String> userIds) {
        Map<String, String> statuses = new LinkedHashMap<>();
        userIds.forEach(id -> statuses.put(id, isOnline(id) ? ONLINE : OFFLINE));
        return statuses;
    }

    // ---- for tests ----

    int openSocketCount(String userId) {
        Set<String> sockets = socketsByUser.get(userId);
        return sockets == null ? 0 : sockets.size();
    }
}
