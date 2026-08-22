package com.ft_transcendence.orgservice.repository;

import com.ft_transcendence.orgservice.model.MemberRole;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.ft_transcendence.orgservice.model.RoleName;
import java.util.Collection;
import com.ft_transcendence.orgservice.model.RoomMember;
import java.util.List;

public interface MemberRoleRepository extends JpaRepository<MemberRole, Long> {

    boolean existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleNameIn(
            Long roomId,
            UUID userId,
            Collection<RoleName> roleNames
    );

    void deleteAllByRoomMember(RoomMember roomMember);

    List<MemberRole> findByRoomMemberRoomId(Long roomId);

    boolean existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
            Long roomId,
            UUID userId,
            RoleName roleName
    );
}