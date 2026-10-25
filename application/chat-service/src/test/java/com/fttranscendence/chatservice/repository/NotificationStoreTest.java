package com.fttranscendence.chatservice.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;

import com.fttranscendence.chatservice.config.MongoIndexConfig;
import com.fttranscendence.chatservice.model.Notification;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/** Real MongoDB: the unique source index, paging by _id and the multi-update. */
@DataMongoTest
@Import({ NotificationStore.class, MongoIndexConfig.class })
class NotificationStoreTest extends MongoTestSupport {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    @Autowired
    private NotificationStore store;

    @Autowired
    private MongoTemplate mongoTemplate;

    @Autowired
    private MongoIndexConfig indexConfig;

    @BeforeEach
    void clean() {
        mongoTemplate.remove(new Query(), Notification.class);
        indexConfig.createIndexes();
    }

    private Notification forUser(String userId, String sourceId) {
        return Notification.of(userId, Notification.ROOM_ADDED, BOB, 42L, null, null, sourceId, NOW);
    }

    @Test
    @DisplayName("insert returns the stored notification with its id, under snake_case keys")
    void insertsWithSnakeCaseKeys() {
        Notification saved = store.insert(forUser(ALICE, "source-1")).orElseThrow();

        assertThat(saved.id()).isNotNull();
        org.bson.Document raw = mongoTemplate.getCollection(Notification.COLLECTION).find().first();
        assertThat(raw).containsKeys("user_id", "type", "actor_id", "room_id", "source_id", "created_at");
        assertThat(raw).doesNotContainKey("userId");
    }

    @Test
    @DisplayName("the same source notifies a user once; another user is unaffected")
    void sameSourceOncePerUser() {
        assertThat(store.insert(forUser(ALICE, "source-1"))).isPresent();
        assertThat(store.insert(forUser(ALICE, "source-1"))).isEmpty();
        assertThat(store.insert(forUser(BOB, "source-1"))).isPresent();

        assertThat(mongoTemplate.count(new Query(), Notification.class)).isEqualTo(2);
    }

    @Test
    @DisplayName("pages newest first, with a cursor, and only the user's own")
    void pagesNewestFirst() {
        List<String> ids = IntStream.range(0, 5)
                .mapToObj(i -> store.insert(forUser(ALICE, "s" + i)).orElseThrow().id())
                .toList();
        store.insert(forUser(BOB, "bob"));

        List<Notification> first = store.page(ALICE, null, 3);
        assertThat(first).extracting(Notification::id).containsExactly(ids.get(4), ids.get(3), ids.get(2));

        List<Notification> next = store.page(ALICE, first.get(2).id(), 3);
        assertThat(next).extracting(Notification::id).containsExactly(ids.get(1), ids.get(0));
    }

    @Test
    @DisplayName("marking read: only the user's own, only once, and the unread count follows")
    void marksRead() {
        String one = store.insert(forUser(ALICE, "1")).orElseThrow().id();
        String two = store.insert(forUser(ALICE, "2")).orElseThrow().id();
        String bobs = store.insert(forUser(BOB, "3")).orElseThrow().id();

        assertThat(store.markRead(ALICE, List.of(one, bobs), NOW)).isEqualTo(1);
        assertThat(store.markRead(ALICE, List.of(one), NOW.plusSeconds(60))).isZero(); // already read
        assertThat(store.unreadCount(ALICE)).isEqualTo(1);
        assertThat(store.unreadCount(BOB)).isEqualTo(1);

        Notification first = store.page(ALICE, null, 10).stream().filter(n -> n.id().equals(one)).findFirst().orElseThrow();
        assertThat(first.readAt()).isEqualTo(NOW); // the first read's time is kept

        assertThat(store.markAllRead(ALICE, NOW)).isEqualTo(1);
        assertThat(store.unreadCount(ALICE)).isZero();
        assertThat(store.page(ALICE, null, 10)).extracting(Notification::id).contains(two);
    }

    @Test
    @DisplayName("the unread count stops at MAX_COUNTED")
    void unreadCountIsCapped() {
        IntStream.range(0, NotificationStore.MAX_COUNTED + 3).forEach(i -> store.insert(forUser(ALICE, "s" + i)));

        assertThat(store.unreadCount(ALICE)).isEqualTo(NotificationStore.MAX_COUNTED);
    }

    @Test
    void roomReadOnlyClearsThisUsersEventsThroughTheReadPositionAcrossAllPages() {
        String boundary = String.format("%024x", 25);
        List<String> read = IntStream.rangeClosed(1, 25)
                .mapToObj(i -> store.insert(forUser(ALICE, String.format("%024x", i))).orElseThrow().id())
                .toList();
        Notification later = store.insert(forUser(ALICE, String.format("%024x", 26))).orElseThrow();
        Notification otherRoom = store.insert(Notification.of(ALICE, Notification.ROLE_CHANGED,
                BOB, 43L, "ADMIN", null, String.format("%024x", 0), NOW)).orElseThrow();
        store.insert(forUser(BOB, boundary));
        Notification friend = store.insert(Notification.of(ALICE, Notification.FRIEND_REQUEST,
                BOB, null, null, "friendship", "friend-event", NOW)).orElseThrow();

        assertThat(store.markRoomRead(ALICE, 42L, boundary, NOW)).containsExactlyInAnyOrderElementsOf(read);
        assertThat(store.markRoomRead(ALICE, 42L, boundary, NOW.plusSeconds(60))).isEmpty();
        assertThat(store.unreadCount(ALICE)).isEqualTo(3);
        assertThat(store.unreadCount(BOB)).isEqualTo(1);
        assertThat(store.page(ALICE, null, 50).stream().filter(n -> n.readAt() == null).map(Notification::id))
                .containsExactlyInAnyOrder(later.id(), otherRoom.id(), friend.id());
        assertThat(store.page(ALICE, null, 50).stream().filter(n -> read.contains(n.id())))
                .allSatisfy(n -> assertThat(n.readAt()).isEqualTo(NOW));
    }

    @Test
    void friendRequestReadCoversEveryPageButNotOtherTypesOrOtherUsers() {
        List<String> requests = IntStream.range(0, 25).mapToObj(i -> store.insert(Notification.of(
                ALICE, Notification.FRIEND_REQUEST, BOB, null, null, "friendship-" + i, "request-" + i, NOW))
                .orElseThrow().id()).toList();
        store.insert(Notification.of(BOB, Notification.FRIEND_REQUEST, ALICE, null, null, "other", "other", NOW));
        Notification room = store.insert(forUser(ALICE, "room-event")).orElseThrow();
        Notification accepted = store.insert(Notification.of(ALICE, Notification.FRIEND_ACCEPTED,
                BOB, null, null, "accepted", "accepted", NOW)).orElseThrow();

        assertThat(store.markFriendRequestsRead(ALICE, NOW)).containsExactlyInAnyOrderElementsOf(requests);
        assertThat(store.markFriendRequestsRead(ALICE, NOW.plusSeconds(60))).isEmpty();
        assertThat(store.unreadCount(ALICE)).isEqualTo(2);
        assertThat(store.unreadCount(BOB)).isEqualTo(1);
        assertThat(store.page(ALICE, null, 50).stream().filter(n -> n.readAt() == null).map(Notification::id))
                .containsExactlyInAnyOrder(room.id(), accepted.id());
        assertThat(store.page(ALICE, null, 50).stream().filter(n -> requests.contains(n.id())))
                .allSatisfy(n -> assertThat(n.readAt()).isEqualTo(NOW));
    }
}
