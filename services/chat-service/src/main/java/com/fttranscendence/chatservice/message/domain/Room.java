package com.fttranscendence.chatservice.message.domain;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "rooms")
public class Room {

    @Id
    private String id;

    private RoomType type;

    private String name;          // null for DMs, set for groups

    // Queried on every GET /api/rooms via findByMemberIdsContaining. Mongo
    // indexes each element of the array separately (a "multikey" index), so a
    // lookup by one member id is a direct index hit, not a scan of every room.
    @Indexed
    private List<String> memberIds;

    private Instant createdAt;

    public enum RoomType { DM, GROUP }
}