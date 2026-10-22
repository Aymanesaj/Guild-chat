package com.fttranscendence.chatservice.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.bson.Document;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.index.IndexInfo;
import com.fttranscendence.chatservice.support.MongoTestSupport;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.SystemEvent;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

/**
 * The index is what keeps history reads from scanning the whole collection.
 * Nothing in MongoDB or Spring Data creates it for us, so it is worth a test
 * that fails the day someone deletes MongoIndexConfig.
 */
@DataMongoTest
@Import(MongoIndexConfig.class)
class MongoIndexConfigTest extends MongoTestSupport {

    @Autowired
    private MongoIndexConfig indexConfig;

    @Autowired
    private MongoTemplate mongoTemplate;

    private static final long ROOM = 4242L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Test
    @DisplayName("creates the room history index with the exact keys and order")
    void createsRoomHistoryIndex() {
        indexConfig.createIndexes();

        IndexInfo index = roomHistoryIndex();

        assertThat(index).as("index %s must exist", MongoIndexConfig.ROOM_HISTORY_INDEX).isNotNull();
        assertThat(index.getIndexFields()).hasSize(2);

        // room_id first: the field we filter on must lead the compound index.
        assertThat(index.getIndexFields().get(0).getKey()).isEqualTo("room_id");
        assertThat(index.getIndexFields().get(0).getDirection()).isEqualTo(Sort.Direction.ASC);

        // _id descending: newest first, so no in-memory sort is needed.
        assertThat(index.getIndexFields().get(1).getKey()).isEqualTo("_id");
        assertThat(index.getIndexFields().get(1).getDirection()).isEqualTo(Sort.Direction.DESC);

        assertThat(index.isUnique()).isFalse();
    }

    @Test
    @DisplayName("running it twice is safe (every application start calls it)")
    void isIdempotent() {
        indexConfig.createIndexes();
        int afterFirstRun = indexes().size();

        indexConfig.createIndexes();

        assertThat(indexes()).hasSize(afterFirstRun);
    }

    @Test
    @DisplayName("MongoDB actually uses the index for a room history query")
    void queryPlanUsesTheIndex() {
        indexConfig.createIndexes();

        Document explain = mongoTemplate.getDb().runCommand(new Document("explain",
                new Document("find", MongoIndexConfig.COLLECTION)
                        .append("filter", new Document("room_id", 42L))
                        .append("sort", new Document("_id", -1))
                        .append("limit", 50)));

        String plan = explain.toJson();

        // IXSCAN = index scan. COLLSCAN would mean the index is not being used.
        assertThat(plan).contains("IXSCAN");
        assertThat(plan).contains(MongoIndexConfig.ROOM_HISTORY_INDEX);
        assertThat(plan).doesNotContain("COLLSCAN");
    }

    @Test
    @DisplayName("creates a unique index on event_id that covers system messages only")
    void createsPartialUniqueEventIdIndex() {
        indexConfig.createIndexes();

        IndexInfo index = indexes().stream()
                .filter(info -> MongoIndexConfig.SYSTEM_EVENT_INDEX.equals(info.getName()))
                .findFirst()
                .orElse(null);

        assertThat(index).as("index %s must exist", MongoIndexConfig.SYSTEM_EVENT_INDEX).isNotNull();
        assertThat(index.getIndexFields()).hasSize(1);
        assertThat(index.getIndexFields().get(0).getKey()).isEqualTo("event_id");
        assertThat(index.isUnique()).isTrue();
        // Partial: ordinary messages have no event_id and must not collide on "missing".
        assertThat(index.getPartialFilterExpression()).contains("event_id");
    }

    @Test
    @DisplayName("a redelivered room event cannot be stored twice, ordinary messages are unaffected")
    void duplicateEventIdIsRejected() {
        indexConfig.createIndexes();
        String eventId = UUID.randomUUID().toString();
        SystemEvent left = new SystemEvent("MEMBER_LEFT", ALICE, ALICE, null, null, null, null);

        mongoTemplate.insert(Message.system(ROOM, eventId, left, Instant.now()));

        assertThatThrownBy(() -> mongoTemplate.insert(Message.system(ROOM, eventId, left, Instant.now())))
                .isInstanceOf(DuplicateKeyException.class);
        // Two ordinary messages: neither has event_id, both are stored.
        mongoTemplate.insert(Message.create(ROOM, ALICE, null, "one", "text", Instant.now()));
        mongoTemplate.insert(Message.create(ROOM, ALICE, null, "two", "text", Instant.now()));
        assertThat(mongoTemplate.count(new Query(Criteria.where("event_id").is(eventId)),
                MongoIndexConfig.COLLECTION)).isEqualTo(1);
    }

    private IndexInfo roomHistoryIndex() {
        return indexes().stream()
                .filter(index -> MongoIndexConfig.ROOM_HISTORY_INDEX.equals(index.getName()))
                .findFirst()
                .orElse(null);
    }

    private List<IndexInfo> indexes() {
        return mongoTemplate.indexOps(MongoIndexConfig.COLLECTION).getIndexInfo();
    }
}
