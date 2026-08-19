package com.ft_transcendence.orgservice.repository;

import com.ft_transcendence.orgservice.model.Role;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, Long> {
}