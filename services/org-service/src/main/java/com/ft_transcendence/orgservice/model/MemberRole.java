package com.ft_transcendence.orgservice.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "member_roles",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_member_roles_member_role",
            columnNames = {"room_member_id", "role_id"}
        )
    }
)
public class MemberRole {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "room_member_id", nullable = false)
    private RoomMember roomMember;

    @ManyToOne
    @JoinColumn(name = "role_id", nullable = false)
    private Role role;
}