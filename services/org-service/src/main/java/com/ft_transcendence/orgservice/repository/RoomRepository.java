package com.ft_transcendence.orgservice.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import com.ft_transcendence.orgservice.model.Room;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<Room, Long> {
    @Query("""
        SELECT r
        FROM Room r
        JOIN RoomMember rm ON rm.room = r
        WHERE r.type = com.ft_transcendence.orgservice.model.RoomType.DM
          AND rm.userId = :userId1
          AND EXISTS (
              SELECT rm2
              FROM RoomMember rm2
              WHERE rm2.room = r
                AND rm2.userId = :userId2
          )
    """)
    Optional<Room> findDirectMessageRoomBetweenUsers(
            @Param("userId1") UUID userId1,
            @Param("userId2") UUID userId2
    );
}