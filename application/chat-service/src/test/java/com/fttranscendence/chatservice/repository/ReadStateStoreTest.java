package com.fttranscendence.chatservice.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;

import com.fttranscendence.chatservice.config.MongoIndexConfig;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.ReadState;
import com.fttranscendence.chatservice.model.SystemEvent;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * Real MongoDB: the $max upsert on ObjectIds, the _id comparison and the
 * count limit are database behaviour, not ours.
 */
@DataMongoTest
@Import({ ReadStateStore.class, MongoIndexConfig.class })
class ReadStateStoreTest extends MongoTestSupport {

    private static final long ROOM = 42L;
    private static final long OTHER_ROOM = 99L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String BOB = "b7c1d2e3-0000-4000-8000-000000000002";
    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    @Autowired
    private ReadStateStore store;

    @Autowired
    private MessageRepository messages;

    @Autowired
    private MongoTemplate mongoTemplate;

    @Autowired
    private MongoIndexConfig indexConfig;

    @BeforeEach
    void clean() {
        messages.deleteAll();
        mongoTemplate.remove(new org.springframework.data.mongodb.core.query.Query(), ReadState.class);
        indexConfig.createIndexes();
    }

    private Message send(long roomId, String sender, String content) {
        return messages.save(Message.create(roomId, sender, null, content, "text", NOW));
    }

    @Test
    @DisplayName("the first read creates the mark, stored as an ObjectId under snake_case keys")
    void firstReadCreatesTheMark() {
        Message hello = send(ROOM, BOB, "hello");

        assertThat(store.markRead(ALICE, ROOM, hello.getId(), NOW)).isEqualTo(hello.getId());

        org.bson.Document raw = mongoTemplate.getCollection(ReadState.COLLECTION).find().first();
        assertThat(raw).containsKeys("user_id", "room_id", "last_read_id", "updated_at");
        assertThat(raw.get("last_read_id")).isInstanceOf(ObjectId.class);
        assertThat(raw.get("room_id")).isEqualTo(ROOM);
    }

    @Test
    @DisplayName("the mark only moves forward: reading an older message changes nothing")
    void markOnlyMovesForward() {
        Message older = send(ROOM, BOB, "one");
        Message newer = send(ROOM, BOB, "two");

        store.markRead(ALICE, ROOM, newer.getId(), NOW);

        assertThat(store.markRead(ALICE, ROOM, older.getId(), NOW)).isEqualTo(newer.getId());
        assertThat(mongoTemplate.count(new org.springframework.data.mongodb.core.query.Query(), ReadState.class))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("marks are per user and per room")
    void marksArePerUserAndRoom() {
        Message here = send(ROOM, BOB, "here");
        Message there = send(OTHER_ROOM, BOB, "there");

        store.markRead(ALICE, ROOM, here.getId(), NOW);
        store.markRead(ALICE, OTHER_ROOM, there.getId(), NOW);
        store.markRead(BOB, ROOM, here.getId(), NOW);

        assertThat(store.lastRead(ALICE, List.of(ROOM, OTHER_ROOM, 7L)))
                .containsOnlyKeys(ROOM, OTHER_ROOM)
                .containsEntry(ROOM, here.getId())
                .containsEntry(OTHER_ROOM, there.getId());
    }

    @Test
    @DisplayName("counts others' live messages after the mark; not mine, deleted ones or room events")
    void countsOnlyWhatIsWorthABadge() {
        Message read = send(ROOM, BOB, "already read");
        send(ROOM, BOB, "new 1");
        send(ROOM, BOB, "new 2");
        send(ROOM, ALICE, "my own");
        Message deleted = send(ROOM, BOB, "deleted");
        deleted.markDeleted(NOW);
        messages.save(deleted);
        messages.save(Message.system(ROOM, "event-1",
                new SystemEvent("MEMBER_JOINED", BOB, ALICE, null, null, null, null), NOW));
        send(OTHER_ROOM, BOB, "another room");

        store.markRead(ALICE, ROOM, read.getId(), NOW);

        assertThat(store.unreadCount(ALICE, ROOM, read.getId())).isEqualTo(2);
    }

    @Test
    @DisplayName("without a mark, every message from others counts")
    void withoutAMarkEverythingCounts() {
        send(ROOM, BOB, "one");
        send(ROOM, BOB, "two");
        send(ROOM, ALICE, "mine");

        assertThat(store.unreadCount(ALICE, ROOM, null)).isEqualTo(2);
        assertThat(store.unreadCount(ALICE, OTHER_ROOM, null)).isZero();
    }

    @Test
    @DisplayName("counting stops at MAX_COUNTED")
    void countIsCapped() {
        IntStream.range(0, ReadStateStore.MAX_COUNTED + 5).forEach(i -> send(ROOM, BOB, "m" + i));

        assertThat(store.unreadCount(ALICE, ROOM, null)).isEqualTo(ReadStateStore.MAX_COUNTED);
    }

    @Test
    @DisplayName("deleting a room removes its marks only")
    void deleteByRoom() {
        store.markRead(ALICE, ROOM, send(ROOM, BOB, "a").getId(), NOW);
        store.markRead(ALICE, OTHER_ROOM, send(OTHER_ROOM, BOB, "b").getId(), NOW);

        store.deleteByRoomId(ROOM);

        assertThat(store.lastRead(ALICE, List.of(ROOM, OTHER_ROOM))).containsOnlyKeys(OTHER_ROOM);
    }
}
