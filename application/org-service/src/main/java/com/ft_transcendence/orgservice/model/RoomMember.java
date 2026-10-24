package com.ft_transcendence.orgservice.model;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

@Entity
@Table(
    name = "room_members",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_room_members_room_user",
            columnNames = {"room_id", "user_id"}
        )
    }
)
public class RoomMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "room_id", nullable = false)
    private Room room;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "last_read_at")
    private Instant lastReadAt;

    @Column(name = "hidden_at")
    private Instant hiddenAt;

    public Instant getHiddenAt() {
        return hiddenAt;
    }

    public void setHiddenAt(Instant hiddenAt) {
        this.hiddenAt = hiddenAt;
    }

    // setters
    public void setRoom(Room room) {
        this.room = room;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public void setLastReadAt(Instant lastReadAt) {
        this.lastReadAt = lastReadAt;
    }

    // getters
    public Room getRoom() {
        return room;
    }

    public UUID getUserId() {
        return userId;
    }

    public Instant getLastReadAt() {
        return lastReadAt;
    }

    public Long getId() {
        return id;
    }
}