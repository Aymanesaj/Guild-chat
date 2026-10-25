package com.fttranscendence.chatservice.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.bson.types.ObjectId;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import com.fttranscendence.chatservice.model.Notification;

/** A user's notifications: newest first, cursor-paginated like history. */
@Repository
public class NotificationStore {

    /** Counting stops here: a badge shows "99+" past it anyway. */
    public static final int MAX_COUNTED = 100;

    private final MongoTemplate mongoTemplate;

    public NotificationStore(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    /**
     * Stores it, unless this user already has one from the same source (a
     * redelivered event).
     *
     * @return the stored notification, empty for a duplicate
     */
    public Optional<Notification> insert(Notification notification) {
        try {
            return Optional.of(mongoTemplate.insert(notification));
        } catch (DuplicateKeyException e) {
            return Optional.empty();
        }
    }

    /** Newest first; with `before`, only those older than that notification. */
    public List<Notification> page(String userId, String before, int limit) {
        Criteria criteria = Criteria.where("user_id").is(userId);
        if (before != null) {
            criteria.and("_id").lt(new ObjectId(before));
        }
        Query query = new Query(criteria).with(Sort.by(Sort.Direction.DESC, "_id")).limit(limit);
        return mongoTemplate.find(query, Notification.class);
    }

    public int unreadCount(String userId) {
        Query query = new Query(Criteria.where("user_id").is(userId).and("read_at").is(null)).limit(MAX_COUNTED);
        return (int) mongoTemplate.count(query, Notification.class);
    }

    /** Marks these of the user's notifications read; ids of other users are ignored. */
    public long markRead(String userId, Collection<String> ids, Instant now) {
        List<ObjectId> objectIds = ids.stream().map(ObjectId::new).toList();
        return markRead(Criteria.where("user_id").is(userId).and("_id").in(objectIds), now);
    }

    public long markAllRead(String userId, Instant now) {
        return markRead(Criteria.where("user_id").is(userId), now);
    }

    /** Room notifications use the system message id as their source. */
    public List<String> markRoomRead(String userId, Long roomId, String lastReadId, Instant now) {
        return markMatchingRead(userId, Criteria.where("user_id").is(userId)
                .and("room_id").is(roomId)
                .and("type").in(Notification.ROOM_ADDED, Notification.ROOM_REMOVED, Notification.ROLE_CHANGED)
                .and("source_id").lte(lastReadId), now);
    }

    public List<String> markFriendRequestsRead(String userId, Instant now) {
        return markMatchingRead(userId, Criteria.where("user_id").is(userId)
                .and("type").is(Notification.FRIEND_REQUEST), now);
    }

    private List<String> markMatchingRead(String userId, Criteria criteria, Instant now) {
        Query query = new Query(criteria.and("read_at").is(null));
        query.fields().include("_id");
        List<String> ids = mongoTemplate.find(query, Notification.class).stream().map(Notification::id).toList();
        if (!ids.isEmpty()) markRead(userId, ids, now);
        return ids;
    }

    private long markRead(Criteria criteria, Instant now) {
        // Only unread ones: read_at keeps the time of the first read.
        Query query = new Query(criteria.and("read_at").is(null));
        return mongoTemplate.updateMulti(query, new Update().set("read_at", now), Notification.class)
                .getModifiedCount();
    }
}
