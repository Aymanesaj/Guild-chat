package com.ft_transcendence.orgservice.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import com.ft_transcendence.orgservice.model.Room;
import java.util.Optional;
import com.ft_transcendence.orgservice.model.RoomType;

public interface RoomRepository extends JpaRepository<Room, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Room r where r.id = :roomId")
    Optional<Room> findByIdForUpdate(@Param("roomId") Long roomId);

    Optional<Room> findByTypeAndDmUser1AndDmUser2(
            RoomType type,
            UUID userId1,
            UUID userId2
    );
}
