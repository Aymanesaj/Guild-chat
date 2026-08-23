package com.ft_transcendence.orgservice.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import com.ft_transcendence.orgservice.model.Room;
import java.util.Optional;
import com.ft_transcendence.orgservice.model.RoomType;

public interface RoomRepository extends JpaRepository<Room, Long> {
    Optional<Room> findByTypeAndDmUser1AndDmUser2(
            RoomType type,
            UUID userId1,
            UUID userId2
    );
}