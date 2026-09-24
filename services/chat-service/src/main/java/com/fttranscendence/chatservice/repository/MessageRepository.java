package com.fttranscendence.chatservice.repository;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.data.mongodb.repository.Update;

import com.fttranscendence.chatservice.model.Message;
/**
 * Spring Data generates the implementation from the method names.
 *
 * Cursor pagination : newest first, "before" is a message id.
 * Soft-deleted messages are intentionally NOT filtered out — clients render
 * them as "deleted" and replies pointing at them must still resolve.
 */

public interface MessageRepository extends MongoRepository<Message , String> {


    /**  Newest page of a room:  no cursor yet.*/
    List<Message> findByRoomIdOrderByIdDesc(Long  roomId , Limit limit);

    /** Older page: everything  before cursor, newest first. */

    List<Message> findByRoomIdAndIdLessThanOrderByIdDesc(Long roomId , String before ,Limit limit);

    /**
     * Soft-deletes unless already deleted, in one atomic Mongo operation.
     * Returns 1 if this call deleted it, 0 if it was already deleted.
     */
    @Query("{ '_id': ?0, 'deleted_at': null }")
    @Update("{ '$set': { 'deleted_at': ?1 } }")
    long markDeletedIfLive(String id, Instant deletedAt);

    /** Edits unless deleted meanwhile. 0 means a delete won the race. */
    @Query("{ '_id': ?0, 'deleted_at': null }")
    @Update("{ '$set': { 'content': ?1, 'edited_at': ?2 } }")
    long applyEditIfLive(String id, String content, Instant editedAt);
}
