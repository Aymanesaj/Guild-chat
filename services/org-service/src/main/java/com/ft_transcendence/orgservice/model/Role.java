package com.ft_transcendence.orgservice.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.EnumType;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "roles",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_roles_room_name",
            columnNames = {"room_id", "name"}
        )
    }
)
public class Role {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "room_id", nullable = false)
    private Room room;

    @Enumerated(EnumType.STRING)
    @Column(length = 50, nullable = false)
    private RoleName name;

    // setters
    public void setRoom(Room room) {
        this.room = room;
    }

    public void setName(RoleName name) {
        this.name = name;
    }

    // getters
    public RoleName getName() {
        return name;
    }
}