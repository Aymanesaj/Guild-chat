package com.ft_transcendence.orgservice.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.EnumType;
import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "rooms",
    uniqueConstraints = {
            @UniqueConstraint(
            name = "uk_rooms_dm_users",
            columnNames = {"dm_user_1", "dm_user_2"}
        )
    }
)
public class Room {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RoomType type;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @Column(name = "dm_user_1")
    private UUID dmUser1;

    @Column(name = "dm_user_2")
    private UUID dmUser2;

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }

    // Getters and Setters
    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public RoomType getType() {
        return type;
    }

    public void setType(RoomType type) {
        this.type = type;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public UUID getDmUser1() {
        return dmUser1;
    }

    public void setDmUser1(UUID dmUser1) {
        this.dmUser1 = dmUser1;
    }

    public UUID getDmUser2() {
        return dmUser2;
    }

    public void setDmUser2(UUID dmUser2) {
        this.dmUser2 = dmUser2;
    }
}