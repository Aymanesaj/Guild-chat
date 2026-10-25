package com.fttranscendence.chatservice.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.stream.Collectors;

import org.bson.types.ObjectId;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.model.ReadState;

/**
 * Read marks and unread counts. MongoTemplate rather than a derived
 * repository: the mark is an upsert with $max, which Spring Data cannot
 * generate from a method name.
 */
@Repository
public class ReadStateStore {

    /** Counting stops here: a badge shows "99+" past it anyway. */
    public static final int MAX_COUNTED = 100;

    private final MongoTemplate mongoTemplate;

    public ReadStateStore(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    /**
     * Moves the user's mark forward to messageId, never back: a tab that
     * reports an older message after a newer one changes nothing.
     *
     * @return the mark after the update
     */
    public String markRead(String userId, Long roomId, String messageId, Instant now) {
        Query query = ofUserInRoom(userId, roomId);
        Update update = new Update()
                .max("last_read_id", new ObjectId(messageId))
                .set("updated_at", now);
        FindAndModifyOptions options = FindAndModifyOptions.options().upsert(true).returnNew(true);
        try {
            return mongoTemplate.findAndModify(query, update, options, ReadState.class).lastReadId();
        } catch (DuplicateKeyException e) {
            // Two first reads of this room at once: the other insert won, so this is now an update.
            return mongoTemplate.findAndModify(query, update, options, ReadState.class).lastReadId();
        }
    }

    /** The user's mark in each of these rooms; a room never read is absent. */
    public Map<Long, String> lastRead(String userId, Collection<Long> roomIds) {
        Query query = new Query(Criteria.where("user_id").is(userId).and("room_id").in(roomIds));
        return mongoTemplate.find(query, ReadState.class).stream()
                .collect(Collectors.toMap(ReadState::roomId, ReadState::lastReadId));
    }

    /**
     * Messages other people sent after the mark (all of them without one).
     * Deleted messages and room events (system lines) are not counted.
     * Stops at MAX_COUNTED.
     */
    public int unreadCount(String userId, Long roomId, String lastReadId) {
        Criteria criteria = Criteria.where("room_id").is(roomId)
                .and("content_type").is("text")
                .and("sender_id").ne(userId)
                .and("deleted_at").is(null);
        if (lastReadId != null) {
            criteria.and("_id").gt(new ObjectId(lastReadId));
        }
        return (int) mongoTemplate.count(new Query(criteria).limit(MAX_COUNTED), Message.class);
    }

    /** A deleted room's marks: nobody can read it any more. */
    public void deleteByRoomId(Long roomId) {
        mongoTemplate.remove(new Query(Criteria.where("room_id").is(roomId)), ReadState.class);
    }

    private static Query ofUserInRoom(String userId, Long roomId) {
        return new Query(Criteria.where("user_id").is(userId).and("room_id").is(roomId));
    }
}
