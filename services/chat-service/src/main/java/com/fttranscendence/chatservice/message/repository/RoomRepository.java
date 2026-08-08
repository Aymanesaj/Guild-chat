// message/repository/RoomRepository.java
package com.fttranscendence.chatservice.message.repository;

import com.fttranscendence.chatservice.message.domain.Room;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface RoomRepository extends MongoRepository<Room, String> {
    Optional<Room> findByTypeAndMemberIds(Room.RoomType type, List<String> memberIds);
    List<Room> findByMemberIdsContaining(String userId);
}