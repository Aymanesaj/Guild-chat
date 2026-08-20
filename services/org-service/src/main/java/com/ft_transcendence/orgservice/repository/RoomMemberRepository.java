package com.ft_transcendence.orgservice.repository;

import com.ft_transcendence.orgservice.model.RoomMember;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RoomMemberRepository extends JpaRepository<RoomMember, Long> {
    List<RoomMember> findByUserId(UUID userId);
    
    Boolean existsByRoomIdAndUserId(Long roomId, UUID userId);
}