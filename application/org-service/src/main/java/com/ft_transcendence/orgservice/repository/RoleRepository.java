package com.ft_transcendence.orgservice.repository;

import com.ft_transcendence.orgservice.model.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import com.ft_transcendence.orgservice.model.RoleName;
import java.util.List;

public interface RoleRepository extends JpaRepository<Role, Long> {
    Optional<Role> findByRoomIdAndName(Long roomId, RoleName name);
    void deleteAllByRoomId(Long roomId);
    List<Role> findByRoomId(Long roomId);
}