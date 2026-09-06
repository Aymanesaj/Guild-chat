// message/repository/ChatMessageRepository.java
package com.fttranscendence.chatservice.message.repository;

import com.fttranscendence.chatservice.message.domain.ChatMessage;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ChatMessageRepository extends MongoRepository<ChatMessage, String> {
    List<ChatMessage> findByRoomIdOrderBySentAtDesc(String roomId, Pageable pageable);
}