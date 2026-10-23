package com.fttranscendence.chatservice.repository;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.Aggregation;
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



  /**
     * Newest message of each room, in one query. Rooms with no messages are
     * simply absent from the result.
     *
     * The sort is room_id ASC, _id DESC: the exact shape of the
     * room_id_1__id_-1 index, so Mongo reads one index entry per room
     * instead of every message.
     */
    @Aggregation(pipeline= {
        "{ '$match': { 'room_id': { '$in' : ?0 }  } } ",
        "{ '$sort': { 'room_id' : 1 , '_id' : -1 } }",
        "{ '$group': { '_id' : '$room_id' , 'latest' : { '$first' : '$$ROOT'  } } } ",
        "{ '$replaceRoot' : { 'newRoot' : '$latest' } }"
    })
    List<Message> findLatestMessagesByRoomIds(List<Long> roomIds);


    long deleteByRoomId(Long roomId);


    /** Live messages of a room that carry images: what a room deletion must clean up in media. */
    List<Message> findByRoomIdAndAttachmentsIsNotNullAndDeletedAtIsNull(Long roomId);
}
