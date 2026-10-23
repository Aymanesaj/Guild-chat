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
import com.fttranscendence.chatservice.model.Attachment;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.SystemEvent;
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
    @DisplayName("room cleanup finds only live messages of that room that have images")
    void findsLiveMessagesWithImages() {
        Instant at = Instant.parse("2026-09-20T12:56:51.179Z");
        Attachment image = new Attachment("m1", ALICE, "image/webp", 10, 10);
        Message withImage = repository.save(Message.create(ROOM, ALICE, null, null, "text", at, List.of(image)));
        repository.save(Message.create(ROOM, ALICE, null, "text only", "text", at));
        Message deleted = Message.create(ROOM, ALICE, null, null, "text", at,
                List.of(new Attachment("m2", ALICE, "image/webp", 10, 10)));
        deleted.markDeleted(at);
        repository.save(deleted);
        repository.save(Message.create(OTHER_ROOM, ALICE, null, null, "text", at,
                List.of(new Attachment("m3", ALICE, "image/webp", 10, 10))));

        assertThat(repository.findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(ROOM))
                .extracting(Message::getId)
                .containsExactly(withImage.getId());
    }

    @Test
    @DisplayName("attachments are stored in snake_case and read back; a text message has no attachments key")
    void attachmentsRoundTrip() {
        Attachment image = new Attachment("5d3c0000-0000-4000-8000-000000000001", ALICE, "image/webp", 1600, 1200);
        Message withImage = repository.save(Message.create(ROOM, ALICE, null, null, "text",
                Instant.parse("2026-09-20T12:56:51.179Z"), List.of(image)));
        Message textOnly = repository.save(Message.create(ROOM, ALICE, null, "hi", "text",
                Instant.parse("2026-09-20T12:56:52.179Z"), List.of()));

        org.bson.Document raw = mongoTemplate.getCollection("messages")
                .find(new org.bson.Document("_id", new ObjectId(withImage.getId()))).first();
        org.bson.Document stored = raw.getList("attachments", org.bson.Document.class).get(0);
        assertThat(stored.keySet()).containsExactlyInAnyOrder(
                "media_id", "owner_id", "content_type", "width", "height");

        assertThat(repository.findById(withImage.getId()).orElseThrow().getAttachments()).containsExactly(image);

        org.bson.Document rawText = mongoTemplate.getCollection("messages")
                .find(new org.bson.Document("_id", new ObjectId(textOnly.getId()))).first();
        assertThat(rawText).doesNotContainKey("attachments");
        assertThat(repository.findById(textOnly.getId()).orElseThrow().getAttachments()).isEmpty();
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

    @Test
    void permanentDeletionTargetsOnlyTheNumericRoomId() {
        send(ROOM, "one");
        send(ROOM, "two");
        Message other = send(OTHER_ROOM, "keep");
        assertThat(repository.deleteByRoomId(ROOM)).isEqualTo(2);
        assertThat(repository.deleteByRoomId(ROOM)).isZero();
        assertThat(repository.findAll()).extracting(Message::getId).containsExactly(other.getId());
    }

    // ------------------------------------------ conditional (atomic) writes

    @Test
    @DisplayName("markDeletedIfLive: the first call deletes (1), a second one finds nothing (0)")
    void markDeletedIfLiveOnlyOnce() {
        Message message = send(ROOM, "hello");
        Instant first = Instant.parse("2026-09-24T10:00:00Z");

        assertThat(repository.markDeletedIfLive(message.getId(), first)).isEqualTo(1);
        assertThat(repository.markDeletedIfLive(message.getId(), first.plusSeconds(5))).isEqualTo(0);

        Message stored = repository.findById(message.getId()).orElseThrow();
        assertThat(stored.getDeletedAt()).as("the second call did not move deleted_at").isEqualTo(first);
        assertThat(stored.getContent()).as("soft delete keeps the document").isEqualTo("hello");
    }

    @Test
    @DisplayName("applyEditIfLive: edits a live message, refuses (0) once it is deleted")
    void applyEditIfLiveSkipsDeleted() {
        Message message = send(ROOM, "hello");
        Instant at = Instant.parse("2026-09-24T10:00:00Z");

        assertThat(repository.applyEditIfLive(message.getId(), "edited", at)).isEqualTo(1);
        Message edited = repository.findById(message.getId()).orElseThrow();
        assertThat(edited.getContent()).isEqualTo("edited");
        assertThat(edited.getEditedAt()).isEqualTo(at);

        repository.markDeletedIfLive(message.getId(), at.plusSeconds(1));
        assertThat(repository.applyEditIfLive(message.getId(), "resurrected", at.plusSeconds(2))).isEqualTo(0);
        Message after = repository.findById(message.getId()).orElseThrow();
        assertThat(after.getContent()).isEqualTo("edited");
        assertThat(after.isDeleted()).as("an edit can no longer undo a delete").isTrue();
    }

    @Test
    @DisplayName("the conditional writes match on _id as an ObjectId, and touch no other message")
    void conditionalWritesTouchOnlyTheTarget() {
        Message target = send(ROOM, "target");
        Message other = send(ROOM, "other");

        repository.markDeletedIfLive(target.getId(), Instant.now());

        assertThat(repository.findById(other.getId()).orElseThrow().isDeleted()).isFalse();
    }

    // ---- findLatestMessagesByRoomIds: conversation previews ----

    @Test
    @DisplayName("latest per room: the newest message of each requested room, one each")
    void latestPerRoomPicksTheNewest() {
        send(ROOM, "old");
        send(ROOM, "newest in room");
        send(OTHER_ROOM, "old other");
        send(OTHER_ROOM, "newest in other");

        List<Message> latest = repository.findLatestMessagesByRoomIds(List.of(ROOM, OTHER_ROOM));

        assertThat(latest)
                .extracting(Message::getContent)
                .containsExactlyInAnyOrder("newest in room", "newest in other");
    }

    @Test
    @DisplayName("latest per room: newest means highest _id, even when created_at disagrees")
    void latestPerRoomOrdersById() {
        // saved second, so its ObjectId is higher, but its created_at is older
        repository.save(Message.create(ROOM, ALICE, null, "first saved", "text", Instant.parse("2026-09-20T12:00:00Z")));
        repository.save(Message.create(ROOM, ALICE, null, "second saved", "text", Instant.parse("2020-01-01T00:00:00Z")));

        List<Message> latest = repository.findLatestMessagesByRoomIds(List.of(ROOM));

        assertThat(latest).extracting(Message::getContent).containsExactly("second saved");
    }

    @Test
    @DisplayName("latest per room: rooms not asked for are ignored; rooms with no messages are absent")
    void latestPerRoomOnlyTheRequestedRooms() {
        send(ROOM, "in room");
        send(OTHER_ROOM, "not asked for");

        List<Message> latest = repository.findLatestMessagesByRoomIds(List.of(ROOM, 12345L));

        assertThat(latest).extracting(Message::getRoomId).containsExactly(ROOM);
    }

    @Test
    @DisplayName("latest per room: a deleted newest message is still the newest (the DTO hides it)")
    void latestPerRoomIncludesDeleted() {
        send(ROOM, "older");
        Message newest = send(ROOM, "deleted newest");
        repository.markDeletedIfLive(newest.getId(), Instant.now());

        List<Message> latest = repository.findLatestMessagesByRoomIds(List.of(ROOM));

        assertThat(latest).singleElement().satisfies(m -> {
            assertThat(m.getId()).isEqualTo(newest.getId());
            assertThat(m.isDeleted()).isTrue();
        });
    }

    @Test
    @DisplayName("latest per room: every field is mapped back, not just content")
    void latestPerRoomMapsTheWholeDocument() {
        Message saved = send(ROOM, "hello");

        Message latest = repository.findLatestMessagesByRoomIds(List.of(ROOM)).get(0);

        assertThat(latest.getId()).isEqualTo(saved.getId());
        assertThat(latest.getRoomId()).isEqualTo(ROOM);
        assertThat(latest.getSenderId()).isEqualTo(ALICE);
        assertThat(latest.getContentType()).isEqualTo("text");
        assertThat(latest.getCreatedAt()).isNotNull();
    }

    @Test
    @DisplayName("a system message is stored with snake_case keys and read back whole")
    void systemMessageRoundTrip() {
        String bob = "b7c1d2e3-0000-4000-8000-000000000002";
        Instant occurredAt = Instant.parse("2026-10-22T10:00:00.123Z");
        SystemEvent roleChanged = new SystemEvent("ROLE_CHANGED", ALICE, bob, "ADMIN", "MEMBER", null, null);

        Message saved = repository.save(Message.system(ROOM, "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                roleChanged, occurredAt));

        org.bson.Document raw = mongoTemplate.getCollection("messages")
                .find(new org.bson.Document("_id", new ObjectId(saved.getId())))
                .first();
        assertThat(raw).isNotNull();
        assertThat(raw.getString("content_type")).isEqualTo("system");
        assertThat(raw.getString("event_id")).isEqualTo("7c9e6679-7425-40de-944b-e07fc1f90ae7");
        assertThat(raw.containsKey("sender_id")).as("no sender stored").isFalse();
        assertThat(raw.containsKey("content")).as("no content stored").isFalse();
        org.bson.Document system = raw.get("system", org.bson.Document.class);
        assertThat(system.getString("type")).isEqualTo("ROLE_CHANGED");
        assertThat(system.getString("actor_id")).isEqualTo(ALICE);
        assertThat(system.getString("target_id")).isEqualTo(bob);
        assertThat(system.getString("previous_role")).isEqualTo("MEMBER");

        Message read = repository.findById(saved.getId()).orElseThrow();
        assertThat(read.isSystem()).isTrue();
        assertThat(read.getSenderId()).isNull();
        assertThat(read.getSystem()).isEqualTo(roleChanged);
        assertThat(read.getCreatedAt()).isEqualTo(occurredAt);
    }

    @Test
    @DisplayName("system messages page through history between ordinary messages")
    void systemMessagesAppearInHistory() {
        Message before = send(ROOM, "before");
        Message system = repository.save(Message.system(ROOM, "0f8fad5b-d9cb-469f-a165-70867728950e",
                new SystemEvent("MEMBER_LEFT", ALICE, ALICE, null, null, null, null), Instant.now()));
        Message after = send(ROOM, "after");

        assertThat(repository.findByRoomIdOrderByIdDesc(ROOM, Limit.of(10)))
                .extracting(Message::getId)
                .containsExactly(after.getId(), system.getId(), before.getId());
        assertThat(before.isSystem()).isFalse();
    }
}
