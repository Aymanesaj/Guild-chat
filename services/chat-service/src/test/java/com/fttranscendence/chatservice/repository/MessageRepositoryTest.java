package com.fttranscendence.chatservice.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.core.MongoTemplate;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * Runs against a real MongoDB in Docker, because the things worth proving here
 * (field mapping, ObjectId cursor comparison, Limit) are all behaviour of the
 * database and the mapping layer, not of our code.
 */
@DataMongoTest
class MessageRepositoryTest extends MongoTestSupport {

    private static final long ROOM = 42L;
    private static final long OTHER_ROOM = 99L;
    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";

    @Autowired
    private MessageRepository repository;

    @Autowired
    private MongoTemplate mongoTemplate;

    @BeforeEach
    void clean() {
        repository.deleteAll();
    }

    private Message send(long roomId, String content) {
        return repository.save(
                Message.create(roomId, ALICE, null, content, "text", Instant.now()));
    }

    @Test
    @DisplayName("saves a message and maps every field to its snake_case document key")
    void mapsFieldsToSnakeCase() {
        Instant createdAt = Instant.parse("2026-09-20T12:56:51.179Z");
        Message saved = repository.save(
                Message.create(ROOM, ALICE, null, "hello", "text", createdAt));

        assertThat(saved.getId()).isNotNull();

        org.bson.Document raw = mongoTemplate.getCollection("messages")
                .find(new org.bson.Document("_id", new ObjectId(saved.getId())))
                .first();

        assertThat(raw).isNotNull();
        assertThat(raw.keySet())
                .contains("room_id", "sender_id", "content", "content_type", "created_at");
        assertThat(raw.get("_id")).isInstanceOf(ObjectId.class);
        assertThat(raw.get("room_id")).isEqualTo(ROOM);          // stored as a number, not a string
        assertThat(raw.get("sender_id")).isEqualTo(ALICE);
        assertThat(raw.getDate("created_at").toInstant()).isEqualTo(createdAt);
        assertThat(raw).doesNotContainKey("roomId");             // no camelCase leaked into the document
    }

    @Test
    @DisplayName("newest page: returns newest first and honours the limit")
    void newestPageIsOrderedAndLimited() {
        send(ROOM, "first");
        send(ROOM, "second");
        send(ROOM, "third");
        send(ROOM, "fourth");

        List<Message> page = repository.findByRoomIdOrderByIdDesc(ROOM, Limit.of(2));

        assertThat(page).extracting(Message::getContent).containsExactly("fourth", "third");
    }

    @Test
    @DisplayName("older page: cursor is exclusive and compares as ObjectId, not as text")
    void cursorPaginationWalksBackwards() {
        Message first = send(ROOM, "first");
        Message second = send(ROOM, "second");
        Message third = send(ROOM, "third");

        List<Message> older = repository
                .findByRoomIdAndIdLessThanOrderByIdDesc(ROOM, third.getId(), Limit.of(10));

        assertThat(older).extracting(Message::getContent).containsExactly("second", "first");
        assertThat(older).extracting(Message::getId).doesNotContain(third.getId());

        List<Message> oldest = repository
                .findByRoomIdAndIdLessThanOrderByIdDesc(ROOM, first.getId(), Limit.of(10));
        assertThat(oldest).isEmpty();

        assertThat(second.getId()).isNotNull();
    }

    @Test
    @DisplayName("history is scoped to one room")
    void doesNotLeakOtherRooms() {
        send(ROOM, "ours");
        send(OTHER_ROOM, "theirs");

        List<Message> page = repository.findByRoomIdOrderByIdDesc(ROOM, Limit.of(10));

        assertThat(page).extracting(Message::getContent).containsExactly("ours");
    }

    @Test
    @DisplayName("soft-deleted messages stay in the history so replies still resolve")
    void keepsSoftDeletedMessages() {
        Message message = send(ROOM, "oops");
        message.markDeleted(Instant.now());
        repository.save(message);

        List<Message> page = repository.findByRoomIdOrderByIdDesc(ROOM, Limit.of(10));

        assertThat(page).hasSize(1);
        assertThat(page.get(0).isDeleted()).isTrue();
        assertThat(page.get(0).getContent()).isEqualTo("oops");
    }

    @Test
    @DisplayName("an edit sets edited_at and keeps created_at untouched")
    void editKeepsCreatedAt() {
        Instant createdAt = Instant.parse("2026-09-20T10:00:00Z");
        Message message = repository.save(
                Message.create(ROOM, ALICE, null, "typo", "text", createdAt));

        message.applyEdit("fixed", Instant.parse("2026-09-20T10:05:00Z"));
        repository.save(message);

        Message reloaded = repository.findById(message.getId()).orElseThrow();
        assertThat(reloaded.getContent()).isEqualTo("fixed");
        assertThat(reloaded.getEditedAt()).isEqualTo(Instant.parse("2026-09-20T10:05:00Z"));
        assertThat(reloaded.getCreatedAt()).isEqualTo(createdAt);
    }
}
