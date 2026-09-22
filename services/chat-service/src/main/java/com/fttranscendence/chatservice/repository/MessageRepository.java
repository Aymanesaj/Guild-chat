package com.fttranscendence.chatservice.repository;

import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;

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
}
