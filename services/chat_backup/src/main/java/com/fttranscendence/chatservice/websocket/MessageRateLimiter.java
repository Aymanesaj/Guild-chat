package com.fttranscendence.chatservice.websocket;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-user token bucket limiting how fast one account may send chat messages.
 *
 * <h2>How a token bucket works</h2>
 * Each user owns a bucket holding at most {@code capacity} tokens. Sending one
 * message costs one token. Tokens are refilled continuously at
 * {@code refillPerSecond}. Empty bucket means the message is rejected.
 *
 * This shape is chosen deliberately over "max N messages per fixed minute":
 * a bucket permits a short natural burst (paste three lines, hit enter three
 * times) while still capping the sustained rate. Fixed windows do the opposite —
 * they block honest bursts, and allow double the intended rate across a window
 * boundary.
 *
 * <h2>Where the state lives</h2>
 * In this object's map, in the heap of one JVM. That is correct for a
 * single-instance deployment and wrong the moment a second chat-service
 * container exists: each instance would grant a full bucket to the same user,
 * so the real limit becomes capacity x instances. Fixing that means moving the
 * counter to somewhere both instances can see — Redis, whose INCR is atomic and
 * which supports key expiry. Not needed today. See notes/04-findings-and-roadmap.md.
 *
 * <h2>Memory</h2>
 * One small entry per user who has ever sent a message since boot. Entries are
 * dropped when the user's last WebSocket session closes ({@link #forget}), so
 * the map tracks connected users rather than growing forever.
 */
@Component
public class MessageRateLimiter {

    private final int capacity;
    private final double refillPerSecond;

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public MessageRateLimiter(
            @Value("${app.chat.rate-limit.capacity:10}") int capacity,
            @Value("${app.chat.rate-limit.refill-per-second:5}") double refillPerSecond) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
    }

    /**
     * @return true if the message is allowed and a token was consumed,
     *         false if the user is over their limit
     */
    public boolean tryConsume(String userId) {
        Bucket bucket = buckets.computeIfAbsent(userId, id -> new Bucket(capacity));
        return bucket.tryConsume(capacity, refillPerSecond);
    }

    /** Drop a user's bucket once they have no sessions left. */
    public void forget(String userId) {
        buckets.remove(userId);
    }

    /**
     * One user's bucket. Every method is synchronized on the bucket itself:
     * a single user with two browser tabs can send from two threads at once,
     * and refill-then-consume must be atomic or both threads could observe the
     * same token and each spend it.
     */
    private static final class Bucket {

        private double tokens;
        private long lastRefillNanos;

        private Bucket(int initialTokens) {
            this.tokens = initialTokens;
            this.lastRefillNanos = System.nanoTime();
        }

        private synchronized boolean tryConsume(int capacity, double refillPerSecond) {
            long now = System.nanoTime();
            double elapsedSeconds = (now - lastRefillNanos) / 1_000_000_000.0;
            lastRefillNanos = now;

            tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);

            if (tokens < 1.0) {
                return false;
            }
            tokens -= 1.0;
            return true;
        }
    }
}
