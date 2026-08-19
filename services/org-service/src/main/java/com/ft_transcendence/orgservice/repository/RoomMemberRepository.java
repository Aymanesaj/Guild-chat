package com.ft_transcendence.orgservice.repository;

import com.ft_transcendence.orgservice.model.RoomMember;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomMemberRepository extends JpaRepository<RoomMember, Long> {
}